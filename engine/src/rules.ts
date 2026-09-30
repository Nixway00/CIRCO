// Pure game rules for $CIRCO. No I/O here, so everything is unit-testable.
import { createHash } from 'node:crypto';

export type BalloonKey = 'green' | 'blue' | 'red' | 'gold';
export interface BalloonDef { capacity_sol: number; weight: number; min_tickets: number; shape: string }
export interface Config {
  ticket_price_tokens: number;
  max_tickets_per_wallet: number;
  countdown_sec: number;
  extension_sec: number;
  max_extensions: number;
  inflate_max_sec: number;
  first_blue_rounds: number;
  last_ticket_bonus: number;
  max_postpones_before_forced_draw: number;
  gala_check_utc_hour: number;
  mission_bonus_tickets: number;
  chat_min_tokens: number;
  balloons: Record<BalloonKey, BalloonDef>;
  jackpot_share?: number;
  jackpot_chance?: number;
  fx_prices?: Record<string, number>;
  team_reward_tickets?: number;
  pick_price_tokens?: number;
  pick_return?: number;
}

export type Phase = 'inflate' | 'countdown' | 'drawing' | 'done' | 'postponed';

export interface RoundState {
  id: number;
  balloon: BalloonKey;
  capacity_sol: number;
  collected_sol: number;
  phase: Phase;
  started_at: number;          // ms
  countdown_ends_at: number | null;
  extensions: number;
  postpone_streak: number;
}

export interface TicketTotal { wallet: string; tickets: number; last_at: number }

// ---------- balloon pick ----------
export function pickBalloon(roundNumber: number, galaDue: boolean, cfg: Config, rand: () => number): BalloonKey {
  if (roundNumber <= cfg.first_blue_rounds) return 'blue';
  if (galaDue) return 'gold';
  // fixed order, so anyone can recompute the balloon from the seed (the database may store keys in any order)
  const keys = (['green', 'blue', 'red', 'gold'] as BalloonKey[]).filter(k => k in cfg.balloons);
  const total = keys.reduce((a, k) => a + cfg.balloons[k].weight, 0);
  let r = rand() * total;
  for (const k of keys) { r -= cfg.balloons[k].weight; if (r <= 0) return k; }
  return 'blue';
}

// ---------- daily gold guarantee (checkpoint at gala_check_utc_hour) ----------
export function lastCheckpoint(now: number, hourUtc: number): number {
  const d = new Date(now);
  let c = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc, 0, 0);
  if (c > now) c -= 86_400_000;
  return c;
}
/** Gold is due if no gold round started in the 24 h before the latest checkpoint (or since it). */
/**
 * The daily gold guarantee. `showStartedAt` is when the very first round started: the guarantee only
 * applies once the show has lived through a checkpoint, so launch day does not open with a forced gold.
 */
export function isGalaDue(now: number, lastGoldStartedAt: number | null, hourUtc: number, showStartedAt: number | null = 0): boolean {
  const cp = lastCheckpoint(now, hourUtc);
  if (showStartedAt === null || showStartedAt > cp) return false;
  return lastGoldStartedAt === null || lastGoldStartedAt < cp - 86_400_000;
}

// ---------- phase machine ----------
export type Action =
  | { type: 'none' }
  | { type: 'start_countdown'; ends_at: number; capacity_sol: number; reason: 'full' | 'timer' }
  | { type: 'extend'; ends_at: number; extensions: number }
  | { type: 'close_and_draw'; forced: boolean }
  | { type: 'postpone' };

export function step(r: RoundState, now: number, ticketCount: number, cfg: Config): Action {
  const min = cfg.balloons[r.balloon].min_tickets;
  if (r.phase === 'inflate') {
    if (r.collected_sol >= r.capacity_sol)
      return { type: 'start_countdown', ends_at: now + cfg.countdown_sec * 1000, capacity_sol: r.capacity_sol, reason: 'full' };
    if (now - r.started_at >= cfg.inflate_max_sec * 1000)
      return { type: 'start_countdown', ends_at: now + cfg.countdown_sec * 1000, capacity_sol: Math.max(r.collected_sol, 0), reason: 'timer' };
    return { type: 'none' };
  }
  if (r.phase === 'countdown' && r.countdown_ends_at !== null && now >= r.countdown_ends_at) {
    if (ticketCount >= min) return { type: 'close_and_draw', forced: false };
    if (r.extensions < cfg.max_extensions)
      return { type: 'extend', ends_at: now + cfg.extension_sec * 1000, extensions: r.extensions + 1 };
    if (r.postpone_streak >= cfg.max_postpones_before_forced_draw && ticketCount > 0)
      return { type: 'close_and_draw', forced: true };
    return { type: 'postpone' };
  }
  return { type: 'none' };
}

// ---------- ticket purchase validation ----------
export function allowedTickets(requested: number, alreadyHeld: number, cfg: Config): number {
  return Math.max(0, Math.min(requested, cfg.max_tickets_per_wallet - alreadyHeld));
}

// ---------- provably fair draw (commit-reveal + closing blockhash) ----------
export function commit(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
/** Anyone can recompute this after the secret is revealed. */
export function drawSeed(secret: string, closeBlockhash: string, roundId: number): string {
  return createHash('sha256').update(`${secret}:${closeBlockhash}:${roundId}`).digest('hex');
}
/**
 * Picks the winning ticket. Tickets are laid out in wallet order (sorted by address, so the order
 * does not depend on the database), each wallet owning a run as long as its ticket count.
 */
export function pickWinner(totals: TicketTotal[], seedHex: string): { wallet: string; ticketIndex: number; total: number } {
  const sorted = [...totals].filter(t => t.tickets > 0).sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  const total = sorted.reduce((a, t) => a + t.tickets, 0);
  if (total === 0) throw new Error('no tickets');
  const idx = Number(BigInt('0x' + seedHex) % BigInt(total));
  let acc = 0;
  for (const t of sorted) { acc += t.tickets; if (idx < acc) return { wallet: t.wallet, ticketIndex: idx, total }; }
  throw new Error('unreachable');
}
/** Pass burn tickets only: free mission tickets cannot snipe the last-ticket bonus. */
export function lastBuyer(totals: TicketTotal[]): string | null {
  if (!totals.length) return null;
  return [...totals].sort((a, b) => b.last_at - a.last_at)[0].wallet;
}
export function splitPrize(prizeSol: number, cfg: Config) {
  const bonus = Math.floor(prizeSol * cfg.last_ticket_bonus * 1e9) / 1e9;
  return { winner: Math.floor((prizeSol - bonus) * 1e9) / 1e9, bonus };
}

// ---------- money and ticket placement (pure, tested) ----------
export const LAMPORTS = 1_000_000_000;

/** Fees count toward the open balloon only while it inflates; later ones wait for the next round. */
export function feeTargetsCurrentRound(phase: Phase | null): boolean {
  return phase === 'inflate';
}

/** SOL collected above capacity when the balloon fills: carried to the next round. */
export function overflowOnFull(collectedSol: number, capacitySol: number): number {
  return Math.max(0, Math.round((collectedSol - capacitySol) * LAMPORTS)) / LAMPORTS;
}

/** Integer lamports so nothing is lost to rounding: the winner gets the remainder after the bonus. */
export function payoutPlan(prizeSol: number, lastBuyerWallet: string | null, cfg: Config) {
  const total = Math.max(0, Math.floor(prizeSol * LAMPORTS));
  const bonus = lastBuyerWallet ? Math.floor(total * cfg.last_ticket_bonus) : 0;
  return { winner: total - bonus, bonus };
}

/**
 * Where a verified burn goes. The memo names a round; if that round is still selling (and the burn
 * landed before the countdown ended) the tickets are normal. Otherwise they are 'late' and go to the
 * round that is open now, or become credits if no round is open at this instant.
 */
export function placeBurn(
  memoRoundId: number,
  blockTimeMs: number,
  open: { id: number; phase: Phase; countdown_ends_at: number | null } | null,
): { roundId: number | null; kind: 'burn' | 'late' } {
  // sales are open only while inflating, or in the countdown before its end (extensions move the end)
  const selling = !!open && (open.phase === 'inflate' || (open.phase === 'countdown' && (open.countdown_ends_at === null || blockTimeMs <= open.countdown_ends_at)));
  if (!open || !selling) return { roundId: null, kind: 'late' };   // closed right now: credit for the next round
  if (open.id === memoRoundId) return { roundId: open.id, kind: 'burn' };
  return { roundId: open.id, kind: 'late' };                        // memo named an older round: count it in the open one
}

/** A sent payment whose blockhash expired without landing can be safely rebuilt and sent again. */
export function payoutNextStep(
  status: 'pending' | 'sent' | 'confirmed' | 'skipped',
  chain: { found: boolean; failed: boolean; blockHeight: number; lastValidHeight: number | null },
): 'send' | 'wait' | 'confirm' | 'resend' | 'done' {
  if (status === 'confirmed' || status === 'skipped') return 'done';
  if (status === 'pending') return 'send';
  if (chain.found && !chain.failed) return 'confirm';
  if (chain.found && chain.failed) return 'resend';
  if (chain.lastValidHeight !== null && chain.blockHeight > chain.lastValidHeight) return 'resend';
  return 'wait';
}

// ---------- shooting gallery (pure, tested) ----------
/**
 * Each shot hits with probability `chance`. Randomness = sha256(secret committed before the burn :
 * burn signature), so neither the player (does not know the secret) nor the engine (cannot pick the
 * player's signature) can steer the result. Anyone can recompute it once the secret is revealed.
 */
export function gameOutcome(secret: string, burnSignature: string, shots: number, chance: number): boolean[] {
  const h = createHash('sha256').update(`${secret}:${burnSignature}`).digest();
  const out: boolean[] = [];
  for (let i = 0; i < shots; i++) out.push(h.readUInt32BE((i * 4) % 28) / 0x1_0000_0000 < chance);
  return out;
}
/** Tickets a wallet can still win in games today; wins above it are simply not paid. */
export function gameTicketsAllowed(hits: number, wonToday: number, dailyCap: number): number {
  return Math.max(0, Math.min(hits, dailyCap - wonToday));
}

// ---------- seeds reused for extra fair draws ----------
/** A number in [0,1) derived from a round seed and a label, so one seed can drive several independent draws. */
export function seedFloat(seed: string, label: string): number {
  return createHash('sha256').update(`${seed}:${label}`).digest().readUInt32BE(0) / 0x1_0000_0000;
}

// ---------- Mega Jackpot ----------
/** Part of every prize-wallet fee that feeds the jackpot instead of the balloon. */
export function jackpotPart(feeSol: number, share: number): number {
  return Math.floor(feeSol * share * LAMPORTS) / LAMPORTS;
}
/** A draw is a Mega Pop when its seed says so and there is something in the jackpot. */
export function isMegaPop(seed: string, chance: number, jackpotSol: number): boolean {
  return jackpotSol >= 0.001 && seedFloat(seed, 'mega') < chance;
}

// ---------- next-balloon predictions ----------
/** Chance of each colour coming up, from the configured weights. */
export function balloonOdds(cfg: Config): Record<BalloonKey, number> {
  const keys = Object.keys(cfg.balloons) as BalloonKey[];
  const total = keys.reduce((a, k) => a + cfg.balloons[k].weight, 0);
  return Object.fromEntries(keys.map(k => [k, cfg.balloons[k].weight / total])) as Record<BalloonKey, number>;
}
/**
 * Tickets paid for a right guess, for a stake worth `stakeTickets` tickets. Expected value stays at
 * `returnRate` of the stake (under 1), so guessing never beats simply buying tickets.
 */
export function pickPayout(chance: number, stakeTickets: number, returnRate: number): number {
  return Math.max(1, Math.floor((stakeTickets * returnRate) / chance));
}
/** The next balloon, drawn from the previous round's revealed seed (or forced by the first rounds / gold guarantee). */
export function nextBalloonFromSeed(roundNumber: number, galaDue: boolean, cfg: Config, seed: string | null): { balloon: BalloonKey; forced: boolean } {
  if (roundNumber <= cfg.first_blue_rounds) return { balloon: 'blue', forced: true };
  if (galaDue) return { balloon: 'gold', forced: true };
  const r = seed ? seedFloat(seed, 'balloon') : Math.random();
  return { balloon: pickBalloon(roundNumber, false, cfg, () => r), forced: false };
}

// ---------- teams ----------
export type Team = 'clowns' | 'acrobats';
/** Monday 00:00 UTC of the week containing `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms); const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
export function teamWinner(clowns: number, acrobats: number): Team | null {
  if (clowns === acrobats) return null;
  return clowns > acrobats ? 'clowns' : 'acrobats';
}
