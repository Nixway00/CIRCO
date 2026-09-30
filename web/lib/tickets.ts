import { PublicKey, Transaction, TransactionInstruction, type Connection } from '@solana/web3.js';
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';

const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const MINT_ADDRESS = process.env.NEXT_PUBLIC_CIRCO_MINT ?? '';
/** Until the token exists the site runs in preview: buying is disabled, balances read as 0. */
export const isLaunched = MINT_ADDRESS.length > 30;
function mint() { if (!isLaunched) throw new Error('$CIRCO is not launched yet. Stay tuned.'); return new PublicKey(MINT_ADDRESS); }

/** One transaction: burn tickets × price $CIRCO + memo "CIRCO:<round>:<tickets>". */
export async function buildTicketTx(connection: Connection, owner: PublicKey, roundId: number, tickets: number, priceTokens: number) {
  const MINT = mint();
  const info = await getMint(connection, MINT);
  const ata = getAssociatedTokenAddressSync(MINT, owner);
  const amount = BigInt(tickets) * BigInt(priceTokens) * 10n ** BigInt(info.decimals);
  return new Transaction()
    .add(createBurnCheckedInstruction(ata, MINT, owner, amount, info.decimals))
    .add(new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(`CIRCO:${roundId}:${tickets}`) }));
}

/** Whole $CIRCO held by a wallet, read in the browser for the chat gate. */
export async function circoBalanceClient(connection: Connection, owner: PublicKey): Promise<number> {
  if (!isLaunched) return 0;
  const res = await connection.getParsedTokenAccountsByOwner(owner, { mint: mint() });
  return res.value.reduce((a, acc) => a + Number((acc.account.data as any).parsed.info.tokenAmount.uiAmount ?? 0), 0);
}
