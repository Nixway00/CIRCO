// Safety net under the Helius webhook: every minute the engine re-reads the latest transactions of the
// prize wallet (fees) and of the $CIRCO mint (memo burns). Anything the webhook missed is counted now;
// anything already counted is skipped, because every write is keyed by the transaction signature.
import { PublicKey, type ParsedTransactionWithMeta } from '@solana/web3.js';
import { connection, prizeKeypair, MINT } from './chain.ts';
import { db, openRound, jackpotShareNow } from './db.ts';
import { feeTargetsCurrentRound, jackpotPart, LAMPORTS, type Config } from './rules.ts';
import { env } from './env.ts';

/** Wallets whose SOL is not a fee: the team (it funds the 0.01 SOL reserve) and anything listed in IGNORE_FEE_FROM. */
export const notFeeSenders = new Set([env.TEAM_WALLET, ...env.IGNORE_FEE_FROM.split(',')].map(s => s.trim()).filter(Boolean));

let lastMintSig: string | undefined;
let lastPrizeSig: string | undefined;

async function recentSignatures(address: PublicKey, until: string | undefined, maxPages = 5) {
  const out: { signature: string; memo: string | null; err: unknown }[] = [];
  let before: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const batch = await connection.getSignaturesForAddress(address, { limit: 100, before, until }, 'confirmed');
    out.push(...batch.map(b => ({ signature: b.signature, memo: b.memo ?? null, err: b.err })));
    if (batch.length < 100) break;
    before = batch[batch.length - 1].signature;
  }
  return out;
}

/** SOL that landed on the prize wallet in a transaction, gross of the network fee if the prize wallet paid it. */
function prizeInflow(tx: ParsedTransactionWithMeta): number {
  const keys = tx.transaction.message.accountKeys;
  const i = keys.findIndex(k => k.pubkey.equals(prizeKeypair.publicKey));
  if (i < 0 || !tx.meta) return 0;
  let delta = tx.meta.postBalances[i] - tx.meta.preBalances[i];
  if (keys[i].signer) delta += tx.meta.fee;
  return delta;
}

export async function reconcileFees(cfg: Config) {
  const sigs = (await recentSignatures(prizeKeypair.publicKey, lastPrizeSig)).filter(s => !s.err);
  if (!sigs.length) return 0;
  const list = sigs.map(s => s.signature);
  const [{ data: known }, { data: paid }] = await Promise.all([
    db.from('fees').select('tx').in('tx', list),
    db.from('payouts').select('signature').in('signature', list),
  ]);
  const skip = new Set([...(known ?? []).map(k => k.tx), ...(paid ?? []).map(p => p.signature)]);
  let added = 0;
  for (const s of sigs.reverse()) {                     // oldest first
    if (skip.has(s.signature)) continue;
    const tx = await connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
    if (!tx) continue;
    if (notFeeSenders.has(tx.transaction.message.accountKeys[0].pubkey.toBase58())) continue;   // a top-up, not a fee
    const lamports = prizeInflow(tx);
    if (lamports <= 0) continue;                         // payouts and other outgoing transactions
    const r = await openRound();
    const amount = lamports / LAMPORTS;
    const { error } = await db.from('fees').upsert({ tx: s.signature, wallet: 'prize', amount_sol: amount, jackpot_sol: jackpotPart(amount, jackpotShareNow(cfg.jackpot_share)), round_id: r && feeTargetsCurrentRound(r.phase) ? r.id : null }, { onConflict: 'tx', ignoreDuplicates: true });
    if (!error) added++;
  }
  lastPrizeSig = sigs[sigs.length - 1]?.signature ?? lastPrizeSig;
  return added;
}

export async function reconcileBurns(route: (signature: string) => Promise<unknown>) {
  const sigs = (await recentSignatures(MINT, lastMintSig)).filter(s => !s.err && s.memo && s.memo.includes('CIRCO'));
  const newest = (await connection.getSignaturesForAddress(MINT, { limit: 1 }, 'confirmed'))[0]?.signature;
  if (sigs.length) {
    const list = sigs.map(s => s.signature);
    const [a, b, c, d] = await Promise.all([
      db.from('processed_burns').select('burn_tx').in('burn_tx', list),
      db.from('games').select('burn_tx').in('burn_tx', list),
      db.from('effects').select('burn_tx').in('burn_tx', list),
      db.from('predictions').select('burn_tx').in('burn_tx', list),
    ]);
    const done = new Set([a, b, c, d].flatMap(x => (x.data ?? []).map((r: any) => r.burn_tx)));
    for (const s of sigs.reverse()) if (!done.has(s.signature)) await route(s.signature).catch(() => {});
  }
  if (newest) lastMintSig = newest;
  return sigs.length;
}
