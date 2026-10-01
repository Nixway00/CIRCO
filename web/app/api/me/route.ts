import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { circoBalance } from '@/lib/verify';

/** The few things that are specific to one wallet: name, team, balance, guesses, lucky meter, game tickets today. */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const wallet = url.searchParams.get('wallet') ?? '';
  const withBal = url.searchParams.get('bal') === '1';
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return NextResponse.json({ error: 'bad wallet' }, { status: 400 });
  const d = new Date(), day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  const { data: round } = await supabase.from('rounds').select('id').order('id', { ascending: false }).limit(1).maybeSingle();
  const [{ data: prof }, { data: games }, { data: cur }, { data: last }, { data: lm }, { data: myT }, { data: lb }, balance] = await Promise.all([
    supabase.from('profiles').select('nickname,x_handle,team,team_set_at').eq('wallet', wallet).maybeSingle(),
    supabase.from('games').select('tickets_given,credited').eq('wallet', wallet).eq('status', 'played').gte('played_at', day),
    round ? supabase.from('predictions').select('round_id,color,tickets_if_win').eq('wallet', wallet).eq('round_id', round.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('predictions').select('id,status,tickets_if_win').eq('wallet', wallet).neq('status', 'open').order('id', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('lucky_meter').select('losing_tickets,free_given').eq('wallet', wallet).maybeSingle(),
    supabase.from('tickets').select('round_id,count').eq('wallet', wallet).order('id', { ascending: false }).limit(500),
    supabase.from('leaderboard').select('*').eq('wallet', wallet).maybeSingle(),
    withBal ? circoBalance(wallet).catch(() => 0) : Promise.resolve(null),
  ]);
  const mine: Record<number, number> = {};
  for (const t of myT ?? []) mine[t.round_id] = (mine[t.round_id] ?? 0) + t.count;
  return NextResponse.json({
    display: prof ? (prof.x_handle ? '@' + prof.x_handle : prof.nickname) : '', nick: prof?.nickname ?? '', xHandle: prof?.x_handle ?? '',
    team: prof?.team ?? '', teamSetAt: prof?.team_set_at ?? null, needNick: !prof, balance,
    wonToday: (games ?? []).reduce((a, g) => a + (g.tickets_given ?? 0) + (g.credited ?? 0), 0),
    myPick: cur ?? null, pickResult: last ?? null, lucky: { losing: lm?.losing_tickets ?? 0, given: lm?.free_given ?? 0 },
    mine, leaderboardRow: lb ?? null,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
