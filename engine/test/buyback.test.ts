import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideBuyback, splitChunks, type BuybackCfg } from '../src/buybackStrategy.ts';

const c: BuybackCfg = { dipPct: 0.12, quietVolumeSol: 5, maxHoldSol: 10, maxHoldHours: 24, minBuySol: 0.05 };
const now = 10_000_000;
const series = (vals: number[]) => vals.map((p, i) => ({ t: now - (vals.length - 1 - i) * 60_000, p }));

test('waits on a calm, busy chart', () => {
  assert.deepEqual(decideBuyback(2, now - 3600_000, { prices: series([1, 1.01, 1, 1.02, 1.01]), volume30mSol: 40, now }, c), { reason: 'wait' });
});
test('buys a dip hard and a deep dip harder', () => {
  const d = decideBuyback(2, now, { prices: series([1, 1, 0.95, 0.87]), volume30mSol: 40, now }, c);
  assert.equal(d.reason, 'dip'); assert.equal((d as any).spendSol, 0.8);
  const dd = decideBuyback(2, now, { prices: series([1, 0.9, 0.7]), volume30mSol: 40, now }, c);
  assert.equal(dd.reason, 'deep_dip'); assert.equal((dd as any).spendSol, 1.6);
});
test('supports a quiet chart that drifts down, gently', () => {
  const d = decideBuyback(2, now, { prices: series([1, 0.99, 0.98, 0.97, 0.96]), volume30mSol: 1, now }, c);
  assert.equal(d.reason, 'quiet_support'); assert.ok(Math.abs((d as any).spendSol - 0.2) < 1e-9);
});
test('never hoards: drips when too much waits or it waited too long', () => {
  assert.equal(decideBuyback(12, now, { prices: series([1, 1, 1]), volume30mSol: 50, now }, c).reason, 'drip');
  assert.equal(decideBuyback(1, now - 25 * 3600_000, { prices: series([1, 1, 1]), volume30mSol: 50, now }, c).reason, 'drip');
});
test('dust is left alone; chunks add up and vary', () => {
  assert.deepEqual(decideBuyback(0.01, now, { prices: series([1, 0.5, 0.2]), volume30mSol: 0, now }, c), { reason: 'wait' });
  const ch = splitChunks(1.6, 0.05);
  assert.ok(ch.length > 1 && ch.length <= 4);
  assert.ok(Math.abs(ch.reduce((a, b) => a + b, 0) - 1.6) < 1e-6);
});
