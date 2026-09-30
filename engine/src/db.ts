import { createClient } from '@supabase/supabase-js';
import { env } from './env.ts';
import type { Config, RoundState, TicketTotal } from './rules.ts';

export const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

export async function loadConfig(): Promise<Config> {
  const { data, error } = await db.from('config').select('key,value');
  if (error) throw error;
  const o: Record<string, unknown> = {};
  for (const r of data!) o[r.key] = r.value;
  return o as unknown as Config;
}

export async function currentRound(): Promise<(RoundState & { carried_sol: number }) | null> {
  const { data, error } = await db.from('rounds').select('*').in('phase', ['inflate', 'countdown']).order('id', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...data,
    capacity_sol: Number(data.capacity_sol), collected_sol: Number(data.collected_sol), carried_sol: Number(data.carried_sol),
    started_at: Date.parse(data.started_at), countdown_ends_at: data.countdown_ends_at ? Date.parse(data.countdown_ends_at) : null,
  };
}

export async function ticketTotals(roundId: number, burnOnly = false): Promise<TicketTotal[]> {
  let q = db.from('tickets').select('wallet,count,created_at,kind').eq('round_id', roundId);
  if (burnOnly) q = q.eq('kind', 'burn');
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
  const { data, error } = await db.from('fees').select('amount_sol').eq('round_id', roundId).eq('wallet', 'prize');
  if (error) throw error;
  return carried + data!.reduce((a, f) => a + Number(f.amount_sol), 0);
}
