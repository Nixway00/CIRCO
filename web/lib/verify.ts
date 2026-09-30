import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Connection, PublicKey } from '@solana/web3.js';

/** The wallet signs a short message; the server checks it, so nobody can post as someone else. */
export function verifySignedMessage(wallet: string, message: string, signatureB58: string): boolean {
  try {
    return nacl.sign.detached.verify(new TextEncoder().encode(message), bs58.decode(signatureB58), new PublicKey(wallet).toBytes());
  } catch { return false; }
}
/** Messages must be fresh: "<action>:<wallet>:<unix ms>", valid for 5 minutes. */
export function freshMessage(message: string, action: string, wallet: string): boolean {
  const [a, w, t] = message.split(':');
  return a === action && w === wallet && Math.abs(Date.now() - Number(t)) < 5 * 60_000;
}
export async function circoBalance(owner: string): Promise<number> {
  if ((process.env.NEXT_PUBLIC_CIRCO_MINT ?? '').length < 30) return 0;
  const conn = new Connection(process.env.RPC_URL!, 'confirmed');
  const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(process.env.NEXT_PUBLIC_CIRCO_MINT!) });
  return res.value.reduce((a, acc) => a + Number((acc.account.data as any).parsed.info.tokenAmount.uiAmount ?? 0), 0);
}
