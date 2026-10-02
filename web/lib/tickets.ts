import { PublicKey, Transaction, TransactionInstruction, type Connection } from '@solana/web3.js';
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const MINT_ADDRESS = process.env.NEXT_PUBLIC_CIRCO_MINT ?? '';
/** Until the token exists the site runs in preview: buying is disabled, balances read as 0. */
export const isLaunched = MINT_ADDRESS.length > 30;
function mint() { if (!isLaunched) throw new Error('$CIRCO is not launched yet. Stay tuned.'); return new PublicKey(MINT_ADDRESS); }

/**
 * Mint info with its token program. pump.fun coins are Token-2022 now, older ones classic SPL Token:
 * the program that owns the mint decides the token-account address and the burn instruction.
 */
let mintCache: { program: PublicKey; decimals: number } | null = null;
async function mintInfo(connection: Connection) {
  if (mintCache) return mintCache;
  const MINT = mint();
  const acc = await connection.getAccountInfo(MINT);
  if (!acc) throw new Error('Token not found on chain.');
  const program = acc.owner.equals(TOKEN_PROGRAM_ID) ? TOKEN_PROGRAM_ID : acc.owner;
  const info = await getMint(connection, MINT, 'confirmed', program);
  mintCache = { program, decimals: info.decimals };
  return mintCache;
}
function burnIx(owner: PublicKey, amount: bigint, m: { program: PublicKey; decimals: number }) {
  const MINT = mint();
  const ata = getAssociatedTokenAddressSync(MINT, owner, false, m.program);
  return createBurnCheckedInstruction(ata, MINT, owner, amount, m.decimals, [], m.program);
}

/** One transaction: burn tickets × price $CIRCO + memo "CIRCO:<round>:<tickets>". */
export async function buildTicketTx(connection: Connection, owner: PublicKey, roundId: number, tickets: number, priceTokens: number) {
  const m = await mintInfo(connection);
  const amount = BigInt(tickets) * BigInt(priceTokens) * 10n ** BigInt(m.decimals);
  return new Transaction()
    .add(burnIx(owner, amount, m))
    .add(new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(`CIRCO:${roundId}:${tickets}`) }));
}

/** Whole $CIRCO held by a wallet, read in the browser for the chat gate. */
export async function circoBalanceClient(connection: Connection, owner: PublicKey): Promise<number> {
  if (!isLaunched) return 0;
  const res = await connection.getParsedTokenAccountsByOwner(owner, { mint: mint() });
  return res.value.reduce((a, acc) => a + Number((acc.account.data as any).parsed.info.tokenAmount.uiAmount ?? 0), 0);
}

/** Shooting gallery: burn exactly the game price with memo "CIRCO-GAME:<gameId>". */
export async function buildGameTx(connection: Connection, owner: PublicKey, gameId: string, priceTokens: number) {
  const m = await mintInfo(connection);
  const amount = BigInt(priceTokens) * 10n ** BigInt(m.decimals);
  return new Transaction()
    .add(burnIx(owner, amount, m))
    .add(new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(`CIRCO-GAME:${gameId}`) }));
}

/** Any show burn: exactly `tokens` $CIRCO with a memo (effects "CIRCO-FX:…", guesses "CIRCO-PICK:…"). */
export async function buildMemoBurnTx(connection: Connection, owner: PublicKey, tokens: number, memo: string) {
  const m = await mintInfo(connection);
  return new Transaction()
    .add(burnIx(owner, BigInt(tokens) * 10n ** BigInt(m.decimals), m))
    .add(new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(memo) }));
}
