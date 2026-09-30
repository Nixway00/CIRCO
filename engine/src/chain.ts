import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, type ParsedInstruction, type PartiallyDecodedInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { env } from './env.ts';

export const connection = new Connection(env.RPC_URL, 'confirmed');
export const MINT = new PublicKey(env.CIRCO_MINT);
export const prizeKeypair = Keypair.fromSecretKey(bs58.decode(env.PRIZE_WALLET_SECRET));
const MEMO_PROGRAMS = new Set(['MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVuDwQkkHtCv']);

let decimalsCache: number | null = null;
export async function mintDecimals(): Promise<number> {
  if (decimalsCache === null) {
    const info = await connection.getParsedAccountInfo(MINT);
    const parsed = (info.value?.data as any)?.parsed;
    decimalsCache = parsed?.info?.decimals ?? 6;
  }
  return decimalsCache!;
}

export interface VerifiedBurn { wallet: string; tickets: number; roundId: number; tokens: bigint; blockTime: number }

export interface Burn { wallet: string; memo: string | null; burned: bigint; decimals: number; blockTime: number }

/** Reads one confirmed transaction: who signed it, its memo, and how much $CIRCO the signer burned. */
export async function readBurn(signature: string): Promise<Burn> {
  const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
  if (!tx || tx.meta?.err) throw new Error('transaction not found or failed');
  const signer = tx.transaction.message.accountKeys.find(k => k.signer)?.pubkey.toBase58();
  if (!signer) throw new Error('no signer');
  const ixs = tx.transaction.message.instructions as (ParsedInstruction | PartiallyDecodedInstruction)[];
  let memo: string | null = null;
  let burned = 0n;
  for (const ix of ixs) {
    if (MEMO_PROGRAMS.has(ix.programId.toBase58())) memo = 'parsed' in ix ? String(ix.parsed) : null;
    if ('parsed' in ix && (ix.parsed?.type === 'burn' || ix.parsed?.type === 'burnChecked')) {
      const info = ix.parsed.info;
      if (info.mint !== MINT.toBase58() || info.authority !== signer) continue;
      burned += BigInt(info.amount ?? info.tokenAmount?.amount ?? 0);
    }
  }
  return { wallet: signer, memo, burned, decimals: await mintDecimals(), blockTime: (tx.blockTime ?? 0) * 1000 };
}

/**
 * A ticket purchase is one transaction that burns exactly tickets × price $CIRCO from the signer
 * and carries the memo "CIRCO:<roundId>:<tickets>". Anything else is rejected.
 */
export async function verifyTicketBurn(signature: string, priceTokens: number): Promise<VerifiedBurn> {
  const b = await readBurn(signature);
  const m = b.memo?.match(/^CIRCO:(\d+):(\d+)$/);
  if (!m) throw new Error('missing or malformed memo');
  const roundId = Number(m[1]), tickets = Number(m[2]);
  if (tickets < 1 || tickets > 10) throw new Error('bad ticket count');
  const expected = BigInt(tickets) * BigInt(priceTokens) * 10n ** BigInt(b.decimals);
  if (b.burned !== expected) throw new Error(`burned ${b.burned}, expected ${expected}`);
  return { wallet: b.wallet, tickets, roundId, tokens: b.burned / 10n ** BigInt(b.decimals), blockTime: b.blockTime };
}

export async function paySol(to: string, sol: number): Promise<string> {
  const lamports = Math.floor(sol * LAMPORTS_PER_SOL);
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: prizeKeypair.publicKey, toPubkey: new PublicKey(to), lamports }));
  return sendAndConfirmTransaction(connection, tx, [prizeKeypair], { commitment: 'confirmed' });
}

/** Slot and blockhash at the moment sales close: mixed into the draw seed. */
export async function closingBlock(): Promise<{ slot: number; blockhash: string }> {
  const slot = await connection.getSlot('finalized');
  const block = await connection.getBlock(slot, { maxSupportedTransactionVersion: 0, transactionDetails: 'none', rewards: false });
  if (!block) throw new Error('block not available');
  return { slot, blockhash: block.blockhash };
}

/** How many whole $CIRCO a wallet holds (for the chat gate). */
export async function circoBalance(owner: string): Promise<number> {
  const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: MINT });
  return res.value.reduce((a, acc) => a + Number((acc.account.data as any).parsed.info.tokenAmount.uiAmount ?? 0), 0);
}

