// Buyback simulation: a fixed-clock buyback vs the smart strategy on 40 synthetic days per market type.
// Run: node --experimental-strip-types engine/sim/buyback-sim.ts

import { decideBuyback as v2, initialState } from '../src/buybackStrategy.ts';
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
function gauss(r: () => number) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }
// one day, 1-minute candles: noise + three dumps (25 min, -35%) each followed by a partial recovery
function path(seed: number, sigma: number) {
  const r = rng(seed); const p = [1]; const minutes = 1440;
  const starts = [300 + Math.floor(r() * 100), 800 + Math.floor(r() * 100), 1200 + Math.floor(r() * 80)];
  for (let i = 1; i < minutes; i++) {
    let drift = 0;
    for (const s of starts) { if (i >= s && i < s + 25) drift -= 0.017; if (i >= s + 25 && i < s + 85) drift += 0.004; }
    p.push(p[i - 1] * Math.exp(drift + sigma * gauss(r)));
  }
  return { p, crashes: starts };
}
const cfg = { dipPct: 0.12, quietVolumeSol: 5, maxHoldSol: 10, maxHoldHours: 24, minBuySol: 0.05 };
type Res = { spent: number; tokens: number; buys: number; knife: number; left: number };
function run(name: string, P: number[], crashes: number[], vol: number, seed: number): Res {
  const rand = rng(seed * 7 + 1);
  let bal = 0, next = 0, st = initialState(), res: Res = { spent: 0, tokens: 0, buys: 0, knife: 0, left: 0 };
  for (let t = 0; t < P.length; t++) {
    bal += 0.02;                                            // fee inflow, about 29 SOL a day
    if (t < next) continue;
    let spend = 0;
    if (name === 'steady') { if (t % 10 === 0) spend = bal; }
    else {
      const prices = P.slice(Math.max(0, t - 360), t + 1).map((p, i, a) => ({ t: (t - (a.length - 1 - i)) * 60000, p }));
      const m = { prices, volume30mSol: vol, now: t * 60000 };
      const o = v2(st, bal, m, cfg as any, rand); st = o.state; if (o.decision.reason !== 'wait') spend = (o.decision as any).spendSol;
    }
    if (spend > 0) {
      bal -= spend; res.spent += spend; res.tokens += spend / P[t]; res.buys++;
      if (crashes.some(s => t >= s && t < s + 12)) res.knife += spend;   // bought in the first half of a dump
      next = t + (name === 'steady' ? 1 : 3 + Math.floor(rand() * 5));
    }
  }
  res.left = bal; return res;
}
for (const [label, sigma, vol] of [['calm, busy', 0.008, 30], ['normal meme', 0.02, 30], ['wild meme', 0.04, 30], ['quiet, drifting', 0.006, 2]] as const) {
  const agg: Record<string, Res> = {};
  for (let s = 1; s <= 40; s++) {
    const { p, crashes } = path(s, sigma);
    for (const n of ['steady', 'smart']) { const r = run(n, p, crashes, vol, s); const a = agg[n] ??= { spent: 0, tokens: 0, buys: 0, knife: 0, left: 0 }; for (const k of Object.keys(r) as (keyof Res)[]) a[k] += r[k]; }
  }
  const base = agg.steady.tokens / agg.steady.spent;
  console.log(`\n${label} (sigma ${sigma}, volume ${vol} SOL/30m)`);
  for (const n of ['steady', 'smart']) {
    const a = agg[n];
    console.log(`  ${n.padEnd(6)} tokens per SOL ${((a.tokens / a.spent) / base * 100).toFixed(0).padStart(4)}% of steady · buys/day ${(a.buys / 40).toFixed(0).padStart(4)} · bought into the first half of dumps ${(a.knife / a.spent * 100).toFixed(0).padStart(3)}% · unspent at day end ${(a.left / 40).toFixed(1)} SOL`);
  }
}
