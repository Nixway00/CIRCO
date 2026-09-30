import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideBuyback, splitChunks, initialState, typicalSwing30, dipThreshold, type BuybackCfg } from '../src/buybackStrategy.ts';

const c: BuybackCfg = { dipPct: 0.12, quietVolumeSol: 5, maxHoldSol: 10, maxHoldHours: 24, minBuySol: 0.05 };
const now = 100 * 3_600_000;
const series = (vals: number[]) => vals.map((p, i) => ({ t: now - (vals.length - 1 - i) * 60_000, p }));
const fixed = () => 0.5;   // no jitter in tests
const run = (vals: number[], sol = 10, vol = 40, st = initialState()) => decideBuyback(st, sol, { prices: series(vals), volume30mSol: vol, now }, c, fixed);

test('calm busy chart: waits', () => {
  assert.equal(run([1, 1.01, 1, 1.02, 1.01, 1, 1.01]).decision.reason, 'wait');
});
test('a one-minute wick is not a dip', () => {
  assert.equal(run([1, 1, 1, 1, 1, 1, 0.8]).decision.reason, 'wait');
});
test('a real dip buys the first tranche only once the price stops falling', () => {
  const falling = run([1, 1, 1, 1, 1, 0.95, 0.9, 0.86, 0.84]);
  assert.equal(falling.decision.reason, 'wait');            // still making new lows
  assert.ok(falling.state.episode);                          // but the dip episode is armed
  const settled = run([1, 1, 1, 1, 1, 0.95, 0.9, 0.86, 0.84, 0.85], 10, 40, falling.state);
  assert.equal(settled.decision.reason, 'dip_1');
  assert.ok(Math.abs((settled.decision as any).spendSol - 10 * 0.7 * 0.25) < 1e-9);   // 25% of the dip budget
  const again = run([1, 1, 1, 1, 1, 0.95, 0.9, 0.86, 0.84, 0.85, 0.85], 10, 40, settled.state);
  assert.equal(again.decision.reason, 'wait');                // the same tranche never fires twice
});
test('deeper levels fire the next tranches; a free fall past a level fires anyway', () => {
  let st = run([1, 1, 1, 1, 1, 0.9, 0.86, 0.87]).state;      // dip_1 fired at -13%
  const d2 = run([1, 1, 1, 1, 1, 0.9, 0.86, 0.87, 0.78, 0.79], 10, 40, st);
  assert.equal(d2.decision.reason, 'dip_2');
  const d3 = run([1, 1, 1, 1, 1, 0.9, 0.86, 0.87, 0.78, 0.79, 0.7, 0.6], 10, 40, d2.state);
  assert.equal(d3.decision.reason, 'dip_3');                 // 40% down, 8 points past its level: no waiting
});
test('the episode ends when the price recovers', () => {
  const st = run([1, 1, 1, 1, 1, 0.9, 0.86, 0.87]).state;
  assert.equal(run([1, 1, 1, 1, 1, 0.9, 0.86, 0.87, 0.97], 10, 40, st).state.episode, null);
});
test('volatile charts need a bigger drop to count as a dip', () => {
  const calm = Array.from({ length: 200 }, (_, i) => ({ t: i * 60_000, p: 1 + (i % 2) * 0.002 }));
  const wild = Array.from({ length: 200 }, (_, i) => ({ t: i * 60_000, p: 1 + (i % 2) * 0.06 }));
  assert.equal(dipThreshold(calm, c), 0.12);
  assert.ok(dipThreshold(wild, c) > 0.2 && dipThreshold(wild, c) <= 0.35);
  assert.ok(typicalSwing30(wild) > typicalSwing30(calm));
});
test('quiet support: small, below the hourly average, then rate-limited', () => {
  const vals = [1, 1, 1, 1, 0.99, 0.98, 0.97, 0.96, 0.955, 0.95];
  const a = run(vals, 10, 1);
  assert.equal(a.decision.reason, 'quiet_support');
  assert.ok(Math.abs((a.decision as any).spendSol - 10 * 0.3 * 0.15) < 1e-9);
  assert.equal(run(vals, 10, 1, a.state).decision.reason, 'wait');   // not again right away
});
test('drip: paced over hours when too much waits, and dust is ignored', () => {
  const d = run([1, 1, 1, 1, 1], 22, 40);
  assert.equal(d.decision.reason, 'drip'); assert.ok(Math.abs((d.decision as any).spendSol - 2) < 1e-9);   // (22 - 10) / 6
  assert.equal(run([1, 1, 1, 1, 1], 22, 40, d.state).decision.reason, 'wait');                            // at most once an hour
  assert.equal(run([1, 0.5, 0.3], 0.01, 0).decision.reason, 'wait');
});
test('chunks add up and vary', () => {
  const ch = splitChunks(1.6, 0.05);
  assert.ok(ch.length > 1 && ch.length <= 4);
  assert.ok(Math.abs(ch.reduce((a, b) => a + b, 0) - 1.6) < 1e-6);
});
