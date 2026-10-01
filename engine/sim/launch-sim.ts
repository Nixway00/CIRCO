// Launch simulation: a market-cap path on the pump.fun bonding curve, the fees it generates, the rounds
// they pay for, the tickets burned, and the REAL buyback bot (engine/src/buybackStrategy.ts) trading on
// the same curve, so its buys move the price.
//
//   node --experimental-strip-types engine/sim/launch-sim.ts            the 30-minute launch path
//   node --experimental-strip-types engine/sim/launch-sim.ts flood      10 SOL of fees every 10 minutes for an hour
//
// Assumptions (change them below): SOL = $150; pump.fun creator fee 0.30% on the bonding curve;
// trading volume = the net flow the chart implies + "churn" (traders flipping in and out).
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { decideBuyback, initialState } from '../src/buybackStrategy.ts';
import { nextBalloonFromSeed, pickWinner, jackpotPart, type Config } from '../src/rules.ts';

const SOL_USD = 150, CREATOR_FEE = 0.003, STEP = 10;             // seconds per simulation step
const V_SOL0 = 30, V_TOK0 = 1_073_000_000, K = V_SOL0 * V_TOK0, SUPPLY = 1_000_000_000;
const TICKET_TOKENS = 10_000;
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

const cfg: Config = {
  ticket_price_tokens: TICKET_TOKENS, max_tickets_per_wallet: 10, countdown_sec: 180, extension_sec: 60, max_extensions: 3,
  inflate_max_sec: 1800, max_postpones_before_forced_draw: 3, last_ticket_bonus: 0.05, first_blue_rounds: 3, first_rounds_balloon: 'green',
  gala_check_utc_hour: 1, jackpot_share: 0.05, jackpot_chance: 0.02, timer_min_fill: 0.25,
  balloons: { green: { shape: 'dog', weight: 40, min_tickets: 50, capacity_sol: 0.5 }, blue: { shape: 'classic', weight: 35, min_tickets: 100, capacity_sol: 1 },
              red: { shape: 'rocket', weight: 20, min_tickets: 150, capacity_sol: 2 }, gold: { shape: 'trophy', weight: 5, min_tickets: 300, capacity_sol: 5 } },
} as any;
const bcfg = { dipPct: 0.12, quietVolumeSol: 5, maxHoldSol: 10, maxHoldHours: 24, minBuySol: 0.05 };

// ---------- the curve ----------
const mcSol = (vSol: number) => vSol * vSol * SUPPLY / K;
const vSolForMcUsd = (usd: number) => Math.sqrt((usd / SOL_USD) * K / SUPPLY);

export interface Scenario { name: string; minutes: number; mcPathK?: number[]; feeFlood?: number; churnSolPerMin: number; wallets: [number, number]; hot: boolean }

export function simulate(sc: Scenario, seed = 1) {
  const r = rng(seed);
  const steps = sc.minutes * 60 / STEP;
  // target curve position at each step, from the market-cap path (with a little noise)
  const target: number[] = [];
  for (let i = 0; i <= steps; i++) {
    if (!sc.mcPathK) { target.push(0); continue; }
    const x = (i / steps) * (sc.mcPathK.length - 1), a = Math.floor(x), b = Math.min(a + 1, sc.mcPathK.length - 1);
    const k = sc.mcPathK[a] + (sc.mcPathK[b] - sc.mcPathK[a]) * (x - a);
    target.push(vSolForMcUsd(k * 1000 * (1 + (r() - 0.5) * 0.04)));
  }
  let vSol = sc.mcPathK ? vSolForMcUsd(sc.mcPathK[0] * 1000) : vSolForMcUsd(60_000);
  let marketPush = 0;                          // SOL the buyback added to the curve (moves the price)
  let burnedTickets = 0, burnedBuyback = 0, volume = 0, feesTotal = 0;
  let prizeQueue = 0, buybackSol = 0, jackpot = 0, teamSol = 0;
  const rounds: any[] = [], buys: any[] = [], series: any[] = [];
  let carriedTickets = new Map<string, number>(), streak = 0;
  let round: any = null, roundNo = 0, prevSeed: string | null = null, nextStartAt = 0, bbState = initialState(), bbNext = 0;
  const prices: { t: number; p: number }[] = [];

  const startRound = (t: number) => {
    roundNo++;
    const pick = nextBalloonFromSeed(roundNo, false, cfg, prevSeed);
    const def = cfg.balloons[pick.balloon];
    let capacity = def.capacity_sol, supercharged = 0;
    const carried = prizeQueue; prizeQueue = 0;
    // hot mode: a big queue supercharges the balloon with half of what is left after filling it
    if (sc.hot && carried > capacity * 2) { supercharged = (carried - capacity) * 0.5; capacity += supercharged; }
    const collected = Math.min(carried, capacity); prizeQueue += carried - collected;
    round = { no: roundNo, balloon: pick.balloon, capacity, supercharged, collected, phase: 'inflate', startedAt: t, endsAt: 0, ext: 0, tickets: new Map<string, number>(carriedTickets), lastBuyer: null };
    carriedTickets = new Map();
  };

  for (let i = 0; i <= steps; i++) {
    const t = i * STEP;
    // ---------- market: move toward the target, plus churn ----------
    let net = 0;
    if (sc.mcPathK) { net = (target[i] + marketPush) - vSol; vSol += net; }
    const churn = (sc.churnSolPerMin * STEP / 60) * (0.6 + r() * 0.8);
    const stepVolume = Math.abs(net) + churn;
    volume += stepVolume;
    let fees = stepVolume * CREATOR_FEE;
    if (sc.feeFlood) fees = sc.feeFlood / (600 / STEP);              // flood: fixed fees per step
    feesTotal += fees;
    const prizePart = fees * 0.45, jp = jackpotPart(prizePart, cfg.jackpot_share!);
    jackpot += jp; buybackSol += fees * 0.45; teamSol += fees * 0.10;
    const toBalloon = prizePart - jp;
    const priceSol = vSol / (K / vSol);
    if (t % 60 === 0) prices.push({ t: t * 1000, p: priceSol });

    // ---------- rounds ----------
    if (!round && t >= nextStartAt) startRound(t);
    if (round) {
      if (round.phase === 'inflate') {
        round.collected += toBalloon;
        if (round.collected >= round.capacity) { prizeQueue += round.collected - round.capacity; round.collected = round.capacity; round.phase = 'countdown'; round.endsAt = t + (sc.hot && prizeQueue >= round.capacity ? 90 : cfg.countdown_sec); }
        else if (t - round.startedAt >= cfg.inflate_max_sec && round.collected >= round.capacity * 0.25) { round.capacity = round.collected; round.phase = 'countdown'; round.endsAt = t + cfg.countdown_sec; }
      } else prizeQueue += toBalloon;                                    // fees during countdown wait in the queue
      // players buy tickets while sales are open
      if (round.phase === 'inflate' || round.phase === 'countdown') {
        const rate = (sc.wallets[0] + r() * (sc.wallets[1] - sc.wallets[0])) / 12;   // wallets per minute, roughly
        if (r() < rate * STEP / 60 * 6) {
          const w = 'w' + Math.floor(r() * 400), held = round.tickets.get(w) ?? 0;
          const n = Math.min(10 - held, 1 + Math.floor(r() * 6));
          if (n > 0) { round.tickets.set(w, held + n); round.lastBuyer = w; burnedTickets += n * TICKET_TOKENS; }
        }
      }
      if (round.phase === 'countdown' && t >= round.endsAt) {
        const total = [...round.tickets.values()].reduce((a: number, b: number) => a + b, 0);
        const min = cfg.balloons[round.balloon as 'green'].min_tickets;
        const forced = streak >= cfg.max_postpones_before_forced_draw && total > 0 && round.ext >= cfg.max_extensions;
        if (total >= min || forced) {
          const drawSeedHex = createHash("sha256").update(`s${seed}:${round.no}:${t}`).digest("hex");
          const win = pickWinner([...round.tickets].map(([wallet, tickets]) => ({ wallet, tickets, last_at: 0 })), drawSeedHex);
          rounds.push({ no: round.no, balloon: round.balloon, prize: +round.capacity.toFixed(3), supercharged: +round.supercharged.toFixed(3), tickets: total, popAt: t, winner: win.wallet });
          prevSeed = drawSeedHex; round = null; streak = 0; nextStartAt = t + 25;           // pop, wheel and payout take about 25 s
        } else if (round.ext < cfg.max_extensions) { round.ext++; round.endsAt = t + cfg.extension_sec; }
        else { rounds.push({ no: round.no, balloon: round.balloon, prize: 0, postponed: true, tickets: total, popAt: t }); prizeQueue += round.collected; carriedTickets = round.tickets; streak++; round = null; nextStartAt = t + 10; }
      }
    }

    // ---------- buyback bot: decides every minute, buys on the same curve ----------
    if (t % 60 === 0 && t >= bbNext) {
      const out = decideBuyback(bbState, buybackSol, { prices: prices.slice(-360), volume30mSol: sc.churnSolPerMin * 30, now: t * 1000 }, bcfg, r);
      bbState = out.state;
      if (out.decision.reason !== 'wait') {
        const sol = out.decision.spendSol; buybackSol -= sol;
        const tokens = (K / vSol) - (K / (vSol + sol));               // tokens out of the curve for this SOL
        vSol += sol; marketPush += sol; burnedBuyback += tokens;
        buys.push({ t, reason: out.decision.reason, sol: +sol.toFixed(3), mcK: +(mcSol(vSol) * SOL_USD / 1000).toFixed(1) });
        bbNext = t + 180 + Math.floor(r() * 300);
      }
    }
    if (t % 60 === 0) series.push({ min: t / 60, mcK: +(mcSol(vSol) * SOL_USD / 1000).toFixed(2), mcNoBotK: +(mcSol(vSol - marketPush) * SOL_USD / 1000).toFixed(2), queue: +prizeQueue.toFixed(3), reserve: +buybackSol.toFixed(3), inRound: round ? round.collected : 0 });
  }
  return {
    scenario: sc.name, volumeSol: volume, volumeUsd: volume * SOL_USD, fees: feesTotal, prizeToBalloons: feesTotal * 0.45 * 0.95, jackpot, team: teamSol,
    rounds, buys, series, queueEnd: prizeQueue, maxQueue: Math.max(...series.map(s => s.queue)), buybackReserveEnd: buybackSol,
    burnedTicketsPct: burnedTickets / SUPPLY * 100, burnedBuybackPct: burnedBuyback / SUPPLY * 100, endMcK: series[series.length - 1].mcK, endMcNoBotK: series[series.length - 1].mcNoBotK,
  };
}

// ---------- run ----------
const which = process.argv[2] ?? 'launch';
const fmt = (n: number, d = 2) => n.toFixed(d);
if (which === 'launch') {
  const path = [10, 13, 15, 20, 13, 10, 15, 17, 25, 30, 22, 20, 19, 17, 22, 27, 35];
  for (const [label, churn] of [['quiet launch', 15], ['normal launch', 35], ['hot launch (~67k$ in 8 min)', 56]] as const) {
    const res = simulate({ name: label, minutes: 30, mcPathK: path, churnSolPerMin: churn, wallets: [10, 40], hot: true });
    console.log(`\n=== ${label}: volume ${fmt(res.volumeSol, 0)} SOL (~$${fmt(res.volumeUsd / 1000, 0)}k) ===`);
    console.log(`creator fees ${fmt(res.fees)} SOL -> balloons ${fmt(res.prizeToBalloons)} · jackpot ${fmt(res.jackpot, 3)} · buyback ${fmt(res.fees * 0.45)} · team ${fmt(res.team)}`);
    console.log(`rounds: ${res.rounds.map(x => x.postponed ? `#${x.no} postponed` : `#${x.no} ${x.balloon} ${x.prize} SOL at min ${fmt(x.popAt / 60, 1)} (${x.tickets} tickets)`).join(' | ') || 'none popped yet'}`);
    console.log(`queue at the end ${fmt(res.queueEnd, 3)} SOL · buyback buys: ${res.buys.map(b => `min ${fmt(b.t / 60, 0)} ${b.reason} ${b.sol} SOL at $${b.mcK}k`).join(', ') || 'none'} · reserve left ${fmt(res.buybackReserveEnd, 3)}`);
    console.log(`burned: tickets ${fmt(res.burnedTicketsPct, 3)}% of supply, buyback ${fmt(res.burnedBuybackPct, 3)}% · end market cap $${res.endMcK}k (without the bot $${res.endMcNoBotK}k)`);
    if (label.startsWith('normal')) writeFileSync('/tmp/launch-normal.json', JSON.stringify(res));
  }
} else {
  for (const hot of [false, true]) {
    const res = simulate({ name: hot ? 'flood, hot mode' : 'flood, current rules', minutes: 60, feeFlood: 10, churnSolPerMin: 100, wallets: [40, 120], hot });
    const popped = res.rounds.filter(x => !x.postponed);
    console.log(`\n=== ${res.scenario}: ${fmt(res.fees, 0)} SOL of fees in 60 min ===`);
    console.log(`rounds popped ${popped.length} · average prize ${fmt(popped.reduce((a, x) => a + x.prize, 0) / popped.length)} SOL · biggest ${fmt(Math.max(...popped.map(x => x.prize)))} SOL · supercharged rounds ${popped.filter(x => x.supercharged > 0).length}`);
    console.log(`prize paid ${fmt(popped.reduce((a, x) => a + x.prize, 0))} SOL · queue at the end ${fmt(res.queueEnd)} SOL (max ${fmt(res.maxQueue)}) · buyback reserve ${fmt(res.buybackReserveEnd)} SOL`);
    console.log(`queue every 10 min: ${res.series.filter(s => s.min % 10 === 0).map(s => s.queue.toFixed(1)).join(' → ')}`);
    writeFileSync(`/tmp/flood-${hot ? 'hot' : 'base'}.json`, JSON.stringify(res));
  }
}
