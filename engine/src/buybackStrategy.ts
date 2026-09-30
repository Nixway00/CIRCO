// When to buy back, and how much. Pure and tested: the buyback bot only executes what this decides.
//
// Instead of buying on a fixed clock (which bots learn to front-run), the buyback wallet keeps its SOL
// and spends it where it does the most: hard into dips, gently when the chart is quiet and drifting,
// and never sits on the money for too long.

export interface BuybackCfg {
  dipPct: number;          // drop from the recent high that counts as a dip (0.12 = 12%)
  quietVolumeSol: number;  // traded volume in 30 minutes under which the chart counts as quiet
  maxHoldSol: number;      // above this, drip it out even without a dip
  maxHoldHours: number;    // nothing waits longer than this
  minBuySol: number;       // no point swapping dust
}
export interface Market {
  prices: { t: number; p: number }[];   // SOL per token, oldest first, at least the last hour if available
  volume30mSol: number;
  now: number;
}
export type Decision = { reason: 'wait' } | { reason: 'dip' | 'deep_dip' | 'quiet_support' | 'drip'; spendSol: number; dropPct?: number };

export function decideBuyback(availableSol: number, oldestUnspentAt: number | null, m: Market, c: BuybackCfg): Decision {
  if (availableSol < c.minBuySol) return { reason: 'wait' };
  const recent = m.prices.filter(x => x.t >= m.now - 30 * 60_000);
  const hour = m.prices.filter(x => x.t >= m.now - 60 * 60_000);
  const last = m.prices[m.prices.length - 1]?.p;
  const clamp = (s: number) => Math.max(c.minBuySol, Math.min(availableSol, s));

  if (last && recent.length >= 3) {
    const high = Math.max(...recent.map(x => x.p));
    const drop = 1 - last / high;
    if (drop >= 2 * c.dipPct) return { reason: 'deep_dip', spendSol: clamp(availableSol * 0.8), dropPct: drop };
    if (drop >= c.dipPct) return { reason: 'dip', spendSol: clamp(availableSol * 0.4), dropPct: drop };
    const avg = hour.reduce((a, x) => a + x.p, 0) / Math.max(1, hour.length);
    if (m.volume30mSol < c.quietVolumeSol && last < avg) return { reason: 'quiet_support', spendSol: clamp(availableSol * 0.1) };
  }
  const heldTooLong = oldestUnspentAt !== null && m.now - oldestUnspentAt > c.maxHoldHours * 3600_000;
  if (availableSol > c.maxHoldSol || heldTooLong) return { reason: 'drip', spendSol: clamp(availableSol * 0.15) };
  return { reason: 'wait' };
}

/** Splits a buy into a few uneven chunks so it does not show up as one predictable order. */
export function splitChunks(total: number, minChunk: number, rand: () => number = Math.random): number[] {
  const n = Math.max(1, Math.min(4, Math.floor(total / minChunk)));
  const w = Array.from({ length: n }, () => 0.5 + rand());
  const s = w.reduce((a, b) => a + b, 0);
  const out = w.map(x => Math.floor((x / s) * total * 1e9) / 1e9);
  out[out.length - 1] = Math.floor((total - out.slice(0, -1).reduce((a, b) => a + b, 0)) * 1e9) / 1e9;
  return out;
}
