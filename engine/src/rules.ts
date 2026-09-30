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
  const keys = Object.keys(cfg.balloons) as BalloonKey[];
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
export function isGalaDue(now: number, lastGoldStartedAt: number | null, hourUtc: number): boolean {
  const cp = lastCheckpoint(now, hourUtc);
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
