// When to buy back, and how much. Pure and tested: the buyback bot only executes what this decides.
//
// Version 2, after stress-testing version 1 on simulated memecoin charts (see docs/buyback.md):
//  - Dips are measured against the coin's own recent volatility, so normal memecoin noise is not a dip.
//  - A dip is bought as a ladder of three tranches at deeper levels, and a tranche only fires once the
//    price stops making new lows. No more spending 40% of the treasury into the first leg of a crash.
//  - The SOL is split: 70% is kept for dips, 30% is "flow" for quiet-chart support and the drip.
//  - Quiet-chart support is rate-limited (at most one small buy every 20-40 minutes).
//  - The drip that stops hoarding is paced over hours instead of dumping in minutes.
//  - Levels and timings carry random jitter, so the exact trigger cannot be gamed.

export interface BuybackCfg {
  dipPct: number;          // smallest drop from the recent high that can count as a dip (0.12 = 12%)
  quietVolumeSol: number;  // traded volume in 30 minutes under which the chart counts as quiet
  maxHoldSol: number;      // above this, drip the excess out
  maxHoldHours: number;    // nothing waits longer than this
  minBuySol: number;       // no point swapping dust
}
export interface Market {
  prices: { t: number; p: number }[];   // SOL per token, oldest first; the strategy looks back up to 6 hours
  volume30mSol: number;
  now: number;
}
export interface Episode { refHigh: number; startedAt: number; levels: number[]; fired: boolean[]; budget: number }
export interface BuybackState { episode: Episode | null; lastQuietAt: number; lastDripAt: number; lastBuyAt: number | null }
export const initialState = (): BuybackState => ({ episode: null, lastQuietAt: 0, lastDripAt: 0, lastBuyAt: null });

export type Reason = 'dip_1' | 'dip_2' | 'dip_3' | 'quiet_support' | 'drip';
export type Decision = { reason: 'wait'; note?: string } | { reason: Reason; spendSol: number; note: string };

const DIP_SHARE = 0.7;                        // of the SOL on hand, kept for dips
const TRANCHES = [0.25, 0.35, 0.40];          // of an episode's budget
const LEVEL_MULT = [1, 1.7, 2.5];             // tranche levels, as multiples of the dip threshold
const MIN = 60_000, HOUR = 3_600_000;

/** Typical 30-minute swing of this chart right now, from the last hours of 1-minute samples. */
export function typicalSwing30(prices: { t: number; p: number }[]): number {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) if (prices[i - 1].p > 0) r.push(Math.log(prices[i].p / prices[i - 1].p));
  if (r.length < 20) return 0;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1));
  return 1 - Math.exp(-sd * Math.sqrt(30));   // a one-sigma 30-minute fall, as a fraction
}

export function dipThreshold(prices: { t: number; p: number }[], c: BuybackCfg): number {
  return Math.min(0.35, Math.max(c.dipPct, 2 * typicalSwing30(prices)));
}

export function decideBuyback(state: BuybackState, availableSol: number, m: Market, c: BuybackCfg, rand: () => number = Math.random): { state: BuybackState; decision: Decision } {
  const s: BuybackState = { ...state, episode: state.episode ? { ...state.episode, fired: [...state.episode.fired] } : null };
  const P = m.prices, last = P[P.length - 1]?.p;
  if (!last || availableSol < c.minBuySol) return { state: s, decision: { reason: 'wait', note: 'no price or no SOL' } };
  const recent = P.filter(x => x.t >= m.now - 30 * MIN);
  const high30 = Math.max(...recent.map(x => x.p));
  const L = dipThreshold(P.filter(x => x.t >= m.now - 6 * HOUR), c);

  // ---------- dip episodes ----------
  let e = s.episode;
  if (e) {
    const drop = 1 - last / e.refHigh;
    const recovered = drop < e.levels[0] / 2, stale = m.now - e.startedAt > 3 * HOUR;
    if (recovered || stale) { s.episode = e = null; }
  }
  if (!e) {
    const prev = P[P.length - 2]?.p ?? last;
    const drop = 1 - last / high30, prevDrop = 1 - prev / high30;
    if (recent.length >= 5 && drop >= L && prevDrop >= L * 0.6) {           // the drop has to persist, not one wick
      const jitter = 0.9 + rand() * 0.2;
      s.episode = e = { refHigh: high30, startedAt: m.now, levels: LEVEL_MULT.map(k => Math.min(0.8, L * k * jitter)), fired: [false, false, false], budget: availableSol * DIP_SHARE };
    }
  }
  if (e) {
    const drop = 1 - last / e.refHigh;
    const prev2 = P.slice(-3, -1).map(x => x.p);
    const stabilised = prev2.length === 2 && last >= Math.min(...prev2);    // not a new low versus the last two minutes
    for (let i = 0; i < 3; i++) {
      if (e.fired[i] || drop < e.levels[i]) continue;
      if (!stabilised && drop < e.levels[i] + 0.08) return { state: s, decision: { reason: 'wait', note: `dip ${i + 1} armed, waiting for the price to stop falling` } };
      e.fired[i] = true;
      const spend = Math.min(availableSol, Math.max(c.minBuySol, e.budget * TRANCHES[i]));
      s.lastBuyAt = m.now;
      return { state: s, decision: { reason: `dip_${i + 1}` as Reason, spendSol: spend, note: `down ${(drop * 100).toFixed(1)}% from the recent high` } };
    }
    return { state: s, decision: { reason: 'wait', note: 'inside a dip, next tranche not reached' } };
  }

  // ---------- flow: quiet-chart support and the drip ----------
  const flow = availableSol * (1 - DIP_SHARE);
  const hour = P.filter(x => x.t >= m.now - HOUR);
  const avg1h = hour.reduce((a, x) => a + x.p, 0) / Math.max(1, hour.length);
  const quietGap = (20 + rand() * 20) * MIN;
  if (m.volume30mSol < c.quietVolumeSol && last < avg1h * 0.97 && m.now - s.lastQuietAt > quietGap && flow * 0.15 >= c.minBuySol) {
    s.lastQuietAt = m.now; s.lastBuyAt = m.now;
    return { state: s, decision: { reason: 'quiet_support', spendSol: flow * 0.15, note: 'quiet chart below its hourly average' } };
  }
  const heldTooLong = s.lastBuyAt !== null ? m.now - s.lastBuyAt > c.maxHoldHours * HOUR : false;
  if ((availableSol > c.maxHoldSol || heldTooLong) && m.now - s.lastDripAt > HOUR) {
    const excess = heldTooLong ? availableSol * 0.5 : availableSol - c.maxHoldSol;
    const spend = Math.min(availableSol, Math.max(c.minBuySol, excess / 6));   // spread over about six hours
    s.lastDripAt = m.now; s.lastBuyAt = m.now;
    return { state: s, decision: { reason: 'drip', spendSol: spend, note: heldTooLong ? 'held too long' : 'above the holding cap' } };
  }
  if (s.lastBuyAt === null) s.lastBuyAt = m.now;          // start the holding clock
  return { state: s, decision: { reason: 'wait' } };
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
