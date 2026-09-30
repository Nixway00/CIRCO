import { Keypair, LAMPORTS_PER_SOL, Transaction, VersionedTransaction } from '@solana/web3.js';
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import { connection, MINT, mintDecimals } from './chain.ts';
import { env } from './env.ts';
import { db } from './db.ts';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUP = 'https://lite-api.jup.ag/swap/v1';
const RESERVE_SOL = 0.02;        // kept in the wallet for network fees
const MIN_BUY_SOL = 0.05;        // no point swapping dust

/**
 * Every few minutes: spend the buyback wallet's SOL on $CIRCO through Jupiter, then burn every
 * $CIRCO the wallet holds. Both transactions are logged in `buybacks` and shown on the site.
 */
export async function runBuyback(): Promise<void> {
  if (!env.BUYBACK_WALLET_SECRET) return;
  const kp = Keypair.fromSecretKey(bs58.decode(env.BUYBACK_WALLET_SECRET));
  const balance = (await connection.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL;
  const spend = balance - RESERVE_SOL;
  let swapSig: string | null = null;

  if (spend >= MIN_BUY_SOL) {
    const lamports = Math.floor(spend * LAMPORTS_PER_SOL);
    const quote = await (await fetch(`${JUP}/quote?inputMint=${SOL_MINT}&outputMint=${MINT.toBase58()}&amount=${lamports}&slippageBps=300`)).json();
    if (!quote?.outAmount) throw new Error(`no Jupiter quote: ${JSON.stringify(quote).slice(0, 200)}`);
    const swap = await (await fetch(`${JUP}/swap`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteResponse: quote, userPublicKey: kp.publicKey.toBase58(), dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto' }),
    })).json();
    const vtx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
    vtx.sign([kp]);
    swapSig = await connection.sendRawTransaction(vtx.serialize(), { maxRetries: 3 });
    await connection.confirmTransaction(swapSig, 'confirmed');
    await db.from('buybacks').insert({ swap_tx: swapSig, sol_spent: spend, tokens_burned: 0 });
  }

  // burn everything the buyback wallet holds (including tokens bought in earlier runs)
  const ata = getAssociatedTokenAddressSync(MINT, kp.publicKey);
  let amount = 0n;
  try { amount = (await getAccount(connection, ata)).amount; } catch { return; }
  if (amount === 0n) return;
  const dec = await mintDecimals();
  const burnSig = await connection.sendTransaction(new Transaction().add(createBurnCheckedInstruction(ata, MINT, kp.publicKey, amount, dec)), [kp]);
  await connection.confirmTransaction(burnSig, 'confirmed');
  const whole = (amount / 10n ** BigInt(dec)).toString();
  if (swapSig) await db.from('buybacks').update({ burn_tx: burnSig, tokens_burned: whole }).eq('swap_tx', swapSig);
  else await db.from('buybacks').insert({ burn_tx: burnSig, sol_spent: 0, tokens_burned: whole });
}
