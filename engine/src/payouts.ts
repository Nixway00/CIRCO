import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { connection, prizeKeypair } from './chain.ts';
import { db } from './db.ts';
import { payoutNextStep } from './rules.ts';

/** Always left in the prize wallet so the next transactions can pay their network fees. */
export const RESERVE_LAMPORTS = 10_000_000;   // 0.01 SOL
const MIN_PAYOUT_LAMPORTS = 5_000;

export interface PlannedPayout { kind: 'winner' | 'bonus' | 'jackpot'; wallet: string; lamports: number }

/** Written once per round; the unique (round, kind) key makes a second call a no-op. */
export async function planPayouts(roundId: number, plan: PlannedPayout[]) {
  const rows = plan.map(p => ({ round_id: roundId, kind: p.kind, wallet: p.wallet, lamports: p.lamports, status: p.lamports < MIN_PAYOUT_LAMPORTS ? 'skipped' : 'pending' }));
  const { error } = await db.from('payouts').upsert(rows, { onConflict: 'round_id,kind', ignoreDuplicates: true });
  if (error) throw error;
}

/**
 * Moves every payout of a round forward by one safe step. The signature is saved BEFORE the
 * transaction is broadcast, so after a crash we look it up on chain instead of paying again;
 * a transaction is rebuilt only once its blockhash has expired without landing.
 * Returns true when every payout is confirmed (or skipped).
 */
export async function settlePayouts(roundId: number): Promise<boolean> {
  const { data: rows, error } = await db.from('payouts').select('*').eq('round_id', roundId).order('id');
  if (error) throw error;
  let allDone = true;
  for (const row of rows ?? []) {
    let chain = { found: false, failed: false, blockHeight: 0, lastValidHeight: row.last_valid_height as number | null };
    if (row.status === 'sent' && row.signature) {
      const st = await connection.getSignatureStatus(row.signature, { searchTransactionHistory: true });
      const v = st.value;
      chain = {
        found: !!v && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized'),
        failed: !!v?.err,
        blockHeight: await connection.getBlockHeight('confirmed'),
        lastValidHeight: row.last_valid_height,
      };
    }
    const next = payoutNextStep(row.status, chain);
    if (next === 'done') continue;
    if (next === 'confirm') { await mark(row.id, { status: 'confirmed' }); continue; }
    if (next === 'wait') { allDone = false; continue; }

    // send or resend
    const balance = await connection.getBalance(prizeKeypair.publicKey, 'confirmed');
    if (balance - row.lamports < RESERVE_LAMPORTS) {
      console.error(`payout ${row.id}: prize wallet has ${balance} lamports, needs ${row.lamports} + reserve; will retry`);
      allDone = false; continue;
    }
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: prizeKeypair.publicKey, blockhash, lastValidBlockHeight })
      .add(SystemProgram.transfer({ fromPubkey: prizeKeypair.publicKey, toPubkey: new PublicKey(row.wallet), lamports: row.lamports }));
    tx.sign(prizeKeypair);
    const signature = bs58.encode(tx.signature!);
    await mark(row.id, { status: 'sent', signature, last_valid_height: lastValidBlockHeight, attempts: row.attempts + 1 });   // record first…
    await connection.sendRawTransaction(tx.serialize(), { maxRetries: 5 });                                                   // …then broadcast
    try {
      const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      if (res.value.err) { allDone = false; continue; }
      await mark(row.id, { status: 'confirmed' });
    } catch { allDone = false; }   // unknown outcome: the next tick checks the chain
  }
  return allDone;
}

async function mark(id: number, patch: Record<string, unknown>) {
  const { error } = await db.from('payouts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;   // never broadcast a payment we could not record
}
