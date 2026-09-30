import { Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { connection, MINT, prizeKeypair } from './chain.ts';

const pump = new OnlinePumpSdk(connection);

/**
 * With fee sharing, Pump.fun does not push fees: they sit in the coin's creator vault until someone
 * runs the (permissionless) distribution. The engine does it on a timer, paying the network fee from
 * the prize wallet. The shares then land directly on the prize, buyback and team wallets, and the
 * Helius webhook sees the SOL arrive on the prize wallet and counts it into the balloon.
 * For graduated coins the SDK first moves the AMM fees into the vault, then distributes.
 */
export async function distributeCreatorFees(): Promise<{ sig: string; lamports: string } | null> {
  const payer = prizeKeypair.publicKey;
  const info = await pump.getMinimumDistributableFee(MINT, payer);
  if (!info.canDistribute) return null;
  const { instructions } = await pump.buildDistributeCreatorFeesInstructions(MINT, { payer });
  if (!instructions.length) return null;
  const tx = new Transaction().add(...instructions);
  const sig = await sendAndConfirmTransaction(connection, tx, [prizeKeypair], { commitment: 'confirmed' });
  return { sig, lamports: info.distributableFees.toString() };
}
