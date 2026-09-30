import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBalloon, isGalaDue, step, allowedTickets, commit, drawSeed, pickWinner, lastBuyer, splitPrize, type Config, type RoundState } from '../src/rules.ts';

const cfg: Config = {
  ticket_price_tokens: 10000, max_tickets_per_wallet: 10, countdown_sec: 180, extension_sec: 60, max_extensions: 3,
  inflate_max_sec: 1800, first_blue_rounds: 3, last_ticket_bonus: 0.05, max_postpones_before_forced_draw: 3,
  gala_check_utc_hour: 1, mission_bonus_tickets: 3, chat_min_tokens: 10000,
  balloons: {
    green: { capacity_sol: 0.5, weight: 40, min_tickets: 50, shape: 'dog' },
    blue: { capacity_sol: 1, weight: 35, min_tickets: 100, shape: 'classic' },
    red: { capacity_sol: 2, weight: 20, min_tickets: 150, shape: 'rocket' },
    gold: { capacity_sol: 5, weight: 5, min_tickets: 300, shape: 'trophy' },
  },
};
const base: RoundState = { id: 7, balloon: 'blue', capacity_sol: 1, collected_sol: 0, phase: 'inflate', started_at: 0, countdown_ends_at: null, extensions: 0, postpone_streak: 0 };

test('first three rounds are blue, then gala wins over randomness', () => {
  assert.equal(pickBalloon(1, true, cfg, () => 0.99), 'blue');
  assert.equal(pickBalloon(3, false, cfg, () => 0.99), 'blue');
  assert.equal(pickBalloon(4, true, cfg, () => 0.0), 'gold');
  assert.equal(pickBalloon(4, false, cfg, () => 0.0), 'green');
  assert.equal(pickBalloon(4, false, cfg, () => 0.999), 'gold');
});

test('daily gold guarantee around the 01:00 UTC checkpoint', () => {
  const now = Date.UTC(2026, 9, 10, 1, 30);                     // 10 Oct 01:30
  assert.equal(isGalaDue(now, Date.UTC(2026, 9, 9, 23, 0), 1), false);  // gold 2.5 h ago
  assert.equal(isGalaDue(now, Date.UTC(2026, 9, 8, 22, 0), 1), true);   // last gold over 24 h before checkpoint
  assert.equal(isGalaDue(now, Date.UTC(2026, 9, 10, 1, 10), 1), false); // already served after checkpoint
  assert.equal(isGalaDue(now, null, 1), true);
  // launch day: the show started after the last checkpoint, so no forced gold yet
  assert.equal(isGalaDue(now, null, 1, Date.UTC(2026, 9, 10, 1, 30)), false);
  assert.equal(isGalaDue(now, null, 1, null), false);
  assert.equal(isGalaDue(now, null, 1, Date.UTC(2026, 9, 9, 20, 0)), true);   // ran through the checkpoint without a gold
});

test('full balloon starts the countdown', () => {
  const a = step({ ...base, collected_sol: 1 }, 1000, 0, cfg);
  assert.equal(a.type, 'start_countdown');
});

test('30-minute timer pops with what it has', () => {
  const a = step({ ...base, collected_sol: 0.4 }, 1800 * 1000, 0, cfg);
  assert.deepEqual(a.type, 'start_countdown');
  if (a.type === 'start_countdown') { assert.equal(a.reason, 'timer'); assert.equal(a.capacity_sol, 0.4); }
});

test('countdown: draw, extend three times, then postpone', () => {
  const cd = { ...base, phase: 'countdown' as const, countdown_ends_at: 5000 };
  assert.equal(step(cd, 5000, 100, cfg).type, 'close_and_draw');
  assert.equal(step(cd, 5000, 99, cfg).type, 'extend');
  assert.equal(step({ ...cd, extensions: 3 }, 5000, 99, cfg).type, 'postpone');
  assert.equal(step({ ...cd, extensions: 2 }, 4999, 0, cfg).type, 'none');
});

test('after three postponements in a row the round is drawn anyway', () => {
  const cd = { ...base, phase: 'countdown' as const, countdown_ends_at: 5000, extensions: 3, postpone_streak: 3 };
  const a = step(cd, 5000, 12, cfg);
  assert.equal(a.type, 'close_and_draw');
  if (a.type === 'close_and_draw') assert.equal(a.forced, true);
  assert.equal(step(cd, 5000, 0, cfg).type, 'postpone');     // nobody to draw
});

test('10-ticket cap', () => {
  assert.equal(allowedTickets(5, 0, cfg), 5);
  assert.equal(allowedTickets(5, 8, cfg), 2);
  assert.equal(allowedTickets(5, 10, cfg), 0);
});

test('draw is deterministic and weighted by tickets', () => {
  const secret = 'b2c1-demo-secret';
  assert.equal(commit(secret).length, 64);
  const seed = drawSeed(secret, '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', 7);
  const totals = [{ wallet: 'B', tickets: 10, last_at: 2 }, { wallet: 'A', tickets: 30, last_at: 1 }];
  const w1 = pickWinner(totals, seed), w2 = pickWinner([...totals].reverse(), seed);
  assert.deepEqual(w1, w2);                                   // order in the DB does not matter
  let a = 0; for (let i = 0; i < 4000; i++) if (pickWinner(totals, drawSeed(secret + i, 'x', 7)).wallet === 'A') a++;
  assert.ok(a > 2800 && a < 3200, `A won ${a}/4000, expected about 3000`);
});

test('last buyer and prize split', () => {
  assert.equal(lastBuyer([{ wallet: 'A', tickets: 1, last_at: 5 }, { wallet: 'B', tickets: 1, last_at: 9 }]), 'B');
  const s = splitPrize(1, cfg);
  assert.equal(s.bonus, 0.05); assert.equal(s.winner, 0.95);
});

import { feeTargetsCurrentRound, overflowOnFull, payoutPlan, placeBurn, payoutNextStep } from '../src/rules.ts';

test('fees only feed a balloon that is still inflating', () => {
  assert.equal(feeTargetsCurrentRound('inflate'), true);
  assert.equal(feeTargetsCurrentRound('countdown'), false);
  assert.equal(feeTargetsCurrentRound('drawing'), false);
  assert.equal(feeTargetsCurrentRound(null), false);
});

test('overflow above capacity is carried, never negative', () => {
  assert.equal(overflowOnFull(1.2345, 1), 0.2345);
  assert.equal(overflowOnFull(0.8, 1), 0);
});

test('payout split is exact in lamports', () => {
  const p = payoutPlan(1, 'B', cfg);
  assert.equal(p.bonus, 50_000_000); assert.equal(p.winner, 950_000_000);
  const q = payoutPlan(0.333333333, 'B', cfg);
  assert.equal(q.winner + q.bonus, 333_333_333);
  assert.equal(payoutPlan(1, null, cfg).winner, 1_000_000_000);
});

test('burns are placed without ever losing tickets', () => {
  const open = { id: 9, phase: 'countdown' as const, countdown_ends_at: 10_000 };
  assert.deepEqual(placeBurn(9, 9_000, open), { roundId: 9, kind: 'burn' });
  assert.deepEqual(placeBurn(9, 11_000, open), { roundId: null, kind: 'late' }); // landed after sales closed: credit, not this draw
  assert.deepEqual(placeBurn(8, 5_000, open), { roundId: 9, kind: 'late' });    // memo for an old round
  assert.deepEqual(placeBurn(9, 5_000, null), { roundId: null, kind: 'late' }); // between rounds: credit
  assert.deepEqual(placeBurn(9, 5_000, { id: 9, phase: 'drawing', countdown_ends_at: 1 }), { roundId: null, kind: 'late' });
});

test('payouts are never sent twice', () => {
  const base = { found: false, failed: false, blockHeight: 100, lastValidHeight: 150 };
  assert.equal(payoutNextStep('pending', base), 'send');
  assert.equal(payoutNextStep('sent', base), 'wait');                           // may still land: do not resend
  assert.equal(payoutNextStep('sent', { ...base, found: true }), 'confirm');
  assert.equal(payoutNextStep('sent', { ...base, blockHeight: 151 }), 'resend'); // expired without landing
  assert.equal(payoutNextStep('sent', { ...base, found: true, failed: true }), 'resend');
  assert.equal(payoutNextStep('confirmed', base), 'done');
});

import { gameOutcome, gameTicketsAllowed } from '../src/rules.ts';

test('shooting gallery: deterministic, about 30% of shots hit, capped per day', () => {
  assert.deepEqual(gameOutcome('s', 'sig', 3, 0.3), gameOutcome('s', 'sig', 3, 0.3));
  let hits = 0, shots = 0;
  for (let i = 0; i < 4000; i++) { for (const h of gameOutcome('secret' + i, 'sig' + i, 3, 0.3)) { shots++; if (h) hits++; } }
  const rate = hits / shots;
  assert.ok(rate > 0.28 && rate < 0.32, `hit rate ${rate}`);
  assert.equal(gameTicketsAllowed(3, 0, 5), 3);
  assert.equal(gameTicketsAllowed(3, 4, 5), 1);
  assert.equal(gameTicketsAllowed(2, 5, 5), 0);
});

import { seedFloat, jackpotPart, isMegaPop, balloonOdds, pickPayout, nextBalloonFromSeed, weekStart, teamWinner } from '../src/rules.ts';

test('mega jackpot: fee split is exact, trigger follows the seed and needs a jackpot', () => {
  assert.equal(jackpotPart(1, 0.05), 0.05);
  assert.equal(jackpotPart(0.123456789, 0.05), 0.006172839);
  let megas = 0;
  for (let i = 0; i < 20000; i++) if (isMegaPop('seed' + i, 0.02, 3)) megas++;
  assert.ok(megas > 300 && megas < 500, `megas ${megas}`);
  assert.equal(isMegaPop('x', 1, 0), false);
});

test('predictions: payouts keep the expected value under the stake', () => {
  const odds = balloonOdds(cfg);
  for (const k of Object.keys(odds) as (keyof typeof odds)[]) {
    const pay = pickPayout(odds[k], 1, 0.9);
    assert.ok(pay * odds[k] <= 0.9 + 1e-9 || pay === 1, `${k}: ${pay} x ${odds[k]}`);
  }
  assert.equal(pickPayout(0.05, 1, 0.9), 18);
});

test('next balloon: forced by the first rounds and the gold guarantee, otherwise from the seed', () => {
  assert.deepEqual(nextBalloonFromSeed(1, false, cfg, 's'), { balloon: 'blue', forced: true });
  assert.deepEqual(nextBalloonFromSeed(10, true, cfg, 's'), { balloon: 'gold', forced: true });
  const a = nextBalloonFromSeed(10, false, cfg, 'same-seed'), b = nextBalloonFromSeed(10, false, cfg, 'same-seed');
  assert.deepEqual(a, b); assert.equal(a.forced, false);
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) seen.add(nextBalloonFromSeed(10, false, cfg, 'seed' + i).balloon);
  assert.equal(seen.size, 4);
  assert.ok(seedFloat('a', 'x') !== seedFloat('a', 'y'));
});

test('teams: week starts Monday UTC, ties have no winner', () => {
  assert.equal(new Date(weekStart(Date.UTC(2026, 9, 1, 15))).toISOString(), '2026-09-28T00:00:00.000Z');   // Thursday -> Monday
  assert.equal(new Date(weekStart(Date.UTC(2026, 9, 5, 0))).toISOString(), '2026-10-05T00:00:00.000Z');   // Monday itself
  assert.equal(teamWinner(5, 3), 'clowns'); assert.equal(teamWinner(1, 9), 'acrobats'); assert.equal(teamWinner(2, 2), null);
});

test('next balloon ignores the key order stored in the database', () => {
  const shuffled = { ...cfg, balloons: { red: cfg.balloons.red, blue: cfg.balloons.blue, gold: cfg.balloons.gold, green: cfg.balloons.green } };
  for (let i = 0; i < 200; i++) assert.deepEqual(nextBalloonFromSeed(10, false, shuffled as any, 's' + i), nextBalloonFromSeed(10, false, cfg, 's' + i));
});

test('the opening rounds can use the green balloon', () => {
  assert.deepEqual(nextBalloonFromSeed(2, false, { ...cfg, first_rounds_balloon: 'green' } as any, 's'), { balloon: 'green', forced: true });
  assert.deepEqual(nextBalloonFromSeed(2, false, cfg, 's'), { balloon: 'blue', forced: true });
});
