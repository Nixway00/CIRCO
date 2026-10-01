import { NextResponse } from 'next/server';

/**
 * The browser's Solana RPC. The real endpoint (with the Helius key) stays on the server; the browser only
 * gets the calls a wallet needs to build, send and confirm a burn and read a balance.
 */
const ALLOWED = new Set([
  'getLatestBlockhash', 'sendTransaction', 'simulateTransaction', 'getSignatureStatuses', 'getAccountInfo', 'getMultipleAccounts',
  'getBalance', 'getTokenAccountsByOwner', 'getParsedTokenAccountsByOwner', 'getTokenAccountBalance', 'getMinimumBalanceForRentExemption',
  'getFeeForMessage', 'getRecentPrioritizationFees', 'getBlockHeight', 'getSlot', 'getEpochInfo', 'isBlockhashValid', 'getVersion', 'getGenesisHash',
]);
const hits = new Map<string, { n: number; t: number }>();   // light per-IP limit, per server instance

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const now = Date.now(), h = hits.get(ip) ?? { n: 0, t: now };
  if (now - h.t > 10_000) { h.n = 0; h.t = now; }
  h.n++; hits.set(ip, h);
  if (h.n > 120) return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: 429, message: 'Too many requests, slow down.' } }, { status: 429 });

  const text = await req.text();
  if (text.length > 100_000) return NextResponse.json({ error: 'too large' }, { status: 413 });
  let body: any; try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length > 20 || calls.some(c => !ALLOWED.has(c?.method))) return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32601, message: 'Method not allowed' } }, { status: 403 });
  const call = (url: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
  let res = await call(process.env.RPC_URL!).catch(() => null);
  // on a free RPC plan a launch spike can hit the rate limit: retry once on the fallback (public Solana RPC by default)
  if (!res || res.status === 429 || res.status >= 500) res = await call(process.env.RPC_FALLBACK_URL || 'https://api.mainnet-beta.solana.com').catch(() => null);
  if (!res) return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'RPC unavailable, try again.' } }, { status: 503 });
  return new NextResponse(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
