import { createHash } from 'node:crypto';

// The same maths the engine uses (engine/src/rules.ts), so anyone can check a round from the win page.
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const drawSeed = (secret: string, blockhash: string, roundId: number) => sha256(`${secret}:${blockhash}:${roundId}`);
export const seedFloat = (seed: string, label: string) => createHash('sha256').update(`${seed}:${label}`).digest().readUInt32BE(0) / 0x1_0000_0000;

export function winningTicket(totals: { wallet: string; tickets: number }[], seed: string) {
  const sorted = totals.filter(t => t.tickets > 0).sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  const total = sorted.reduce((a, t) => a + t.tickets, 0);
  if (!total) return null;
  const idx = Number(BigInt('0x' + seed) % BigInt(total));
  let acc = 0;
  for (const t of sorted) { acc += t.tickets; if (idx < acc) return { wallet: t.wallet, index: idx, total }; }
  return null;
}

export function balloonFromFloat(r: number, weights: Record<string, number>) {
  const keys = ['green', 'blue', 'red', 'gold'].filter(k => k in weights);
  const tot = keys.reduce((a, k) => a + weights[k], 0);
  let x = r * tot;
  for (const k of keys) { x -= weights[k]; if (x <= 0) return k; }
  return 'blue';
}
