import { createClient } from '@supabase/supabase-js';
import { env } from './env.ts';
import type { Config, Phase, RoundState, TicketTotal } from './rules.ts';

export const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

export async function loadConfig(): Promise<Config> {
  const { data, error } = await db.from('config').select('key,value');
  if (error) throw error;
  const o: Record<string, unknown> = {};
  for (const r of data!) o[r.key] = r.value;
  return o as unknown as Config;
}

export type Round = RoundState & { next_seed: string | null; mega: boolean; jackpot_won: number; carried_sol: number; winner_wallet: string | null; last_buyer: string | null; prize_sol: number | null; draw_total_tickets: number | null; forced_gala: boolean };

function toRound(d: any): Round {
  return {
    ...d,
    capacity_sol: Number(d.capacity_sol), collected_sol: Number(d.collected_sol), carried_sol: Number(d.carried_sol),
    prize_sol: d.prize_sol === null ? null : Number(d.prize_sol),
    started_at: Date.parse(d.started_at), countdown_ends_at: d.countdown_ends_at ? Date.parse(d.countdown_ends_at) : null,
  };
}

async function roundIn(phases: Phase[]): Promise<Round | null> {
  const { data, error } = await db.from('rounds').select('*').in('phase', phases).order('id', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? toRound(data) : null;
}
/** The round currently selling tickets (inflating or counting down). */
export const openRound = () => roundIn(['inflate', 'countdown']);
/** A round whose draw started but did not finish (for example the engine restarted mid-draw). */
export const drawingRound = () => roundIn(['drawing']);

export async function ticketTotals(roundId: number, purchasesOnly = false): Promise<TicketTotal[]> {
  let q = db.from('tickets').select('wallet,count,created_at,kind').eq('round_id', roundId);
  if (purchasesOnly) q = q.in('kind', ['burn', 'late']);       // free tickets never win the last-ticket bonus
  const { data, error } = await q;
  if (error) throw error;
  const m = new Map<string, TicketTotal>();
  for (const t of data!) {
    const cur = m.get(t.wallet) ?? { wallet: t.wallet, tickets: 0, last_at: 0 };
    cur.tickets += t.count; cur.last_at = Math.max(cur.last_at, Date.parse(t.created_at));
    m.set(t.wallet, cur);
  }
  return [...m.values()];
}

export async function prizeCollected(roundId: number, carried: number): Promise<number> {
  const { data, error } = await db.from('fees').select('amount_sol,jackpot_sol').eq('round_id', roundId).eq('wallet', 'prize');
  if (error) throw error;
  return carried + data!.reduce((a, f) => a + Number(f.amount_sol) - Number(f.jackpot_sol ?? 0), 0);   // the jackpot part feeds the Mega Jackpot
}

/** SOL waiting in the Mega Jackpot: every jackpot part ever received, minus what Mega Pops paid out. */
export async function jackpotBalance(): Promise<number> {
  const { data, error } = await db.from('public_stats').select('jackpot_sol').single();
  if (error) throw error;
  return Math.max(0, Number(data?.jackpot_sol ?? 0));
}

export interface AddResult { given: number; credited: number; duplicate: boolean }
export async function addTickets(roundId: number | null, wallet: string, count: number, kind: string, burnTx: string | null, tokens: string, cap: number): Promise<AddResult> {
  const { data, error } = await db.rpc('add_tickets', { p_round: roundId, p_wallet: wallet, p_count: count, p_kind: kind, p_burn_tx: burnTx, p_tokens: tokens, p_cap: cap });
  if (error) throw error;
  return data as AddResult;
}
