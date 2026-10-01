import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * Everything the stage shows that is the same for every viewer, in one response.
 * The CDN caches it for one second, so a thousand viewers cost the database the same as one:
 * no per-viewer realtime connections (Supabase caps those at 200 on Free, 500 on Pro).
 */
export const dynamic = 'force-dynamic';

const B2T: Record<string, string> = { green: 'verde', blue: 'blu', red: 'rosso', gold: 'oro' };
const CFG_KEYS = ['ticket_price_tokens', 'chat_min_tokens', 'game_price_tokens', 'game_shots', 'game_hit_chance', 'game_daily_ticket_cap', 'fx_prices',
  'pick_price_tokens', 'pick_return', 'balloons', 'jackpot_share', 'jackpot_chance', 'team_reward_tickets', 'lucky_every'];

// Two parts, so the database is read as little as possible on the free plans:
//  - fast (default, cached 2 s): the round, tickets, trades, chat, effects, headline numbers
//  - slow (?part=slow, cached 20 s): settings, history, leaderboard, team battle
const ROUND_COLS = 'id,balloon,phase,capacity_sol,collected_sol,carried_sol,started_at,countdown_ends_at,extensions,postpone_streak,winner_wallet,winner_tickets,last_buyer,prize_sol,draw_total_tickets,mega,jackpot_won,supercharged_sol,express,snipes,grand_opening,forced_gala,seed_commit,ended_at';

export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get('part') === 'slow') return slow();
  const [{ data: rounds }, { data: trades }, { data: chat }, { data: snaps }, { data: fx }] = await Promise.all([
    supabase.from('rounds').select(ROUND_COLS).order('id', { ascending: false }).limit(2),
    supabase.from('trades').select('tx,wallet,side,amount_sol').order('id', { ascending: false }).limit(12),
    supabase.from('chat_messages').select('id,wallet,body,is_ringmaster,source,author').order('id', { ascending: false }).limit(25),
    supabase.from('snapshots').select('key,data').eq('key', 'stats'),
    supabase.from('effects').select('id,wallet,effect,created_at').order('id', { ascending: false }).limit(10),
  ]);
  const cfgRows: any[] = [];
  const round = rounds?.[0], prev = rounds?.[1];

  // tickets of the current round, totalled per wallet, and the last purchase (on-chain order)
  let tickets: { wallet: string; tickets: number }[] = [], lastBuyer: string | null = null;
  if (round) {
    const { data: t } = await supabase.from('tickets').select('wallet,count,kind,burn_slot,created_at').eq('round_id', round.id);
    const m = new Map<string, number>(); let best = -1;
    for (const x of t ?? []) {
      m.set(x.wallet, (m.get(x.wallet) ?? 0) + x.count);
      if (x.kind === 'burn' || x.kind === 'late') { const k = x.burn_slot != null ? Number(x.burn_slot) : Date.parse(x.created_at) / 400; if (k >= best) { best = k; lastBuyer = x.wallet; } }
    }
    tickets = [...m].map(([wallet, n]) => ({ wallet, tickets: n }));
  }
  const snap = (k: string) => snaps?.find(s => s.key === k)?.data as any;
  const leaderboard: any[] = [];
  const history: any[] = [];

  // display names: @handle if linked, else nickname, else the address (the stage shortens it)
  const wallets = new Set<string>([
    ...tickets.map(t => t.wallet), ...(trades ?? []).map(t => t.wallet), ...(chat ?? []).map(c => c.wallet), ...(fx ?? []).map(e => e.wallet),
    round?.winner_wallet, round?.last_buyer, prev?.winner_wallet, prev?.last_buyer, lastBuyer,
  ].filter((w): w is string => !!w && w.length > 30));
  const names = new Map<string, string>();
  const list = [...wallets];
  for (let i = 0; i < list.length; i += 200) {
    const { data } = await supabase.from('profiles').select('wallet,nickname,x_handle').in('wallet', list.slice(i, i + 200));
    for (const p of data ?? []) names.set(p.wallet, p.x_handle ? '@' + p.x_handle : p.nickname);
  }
  const nm = (w: string | null | undefined) => (w && names.get(w)) || w;
  const named = (r: any) => r && { ...r, winner_wallet: nm(r.winner_wallet), last_buyer: nm(r.last_buyer) };

  const raw = Object.fromEntries((cfgRows ?? []).map(c => [c.key, c.value as any]));
  const st = snap('stats') ?? {};
  const body = {
    round: named(round), prev: named(prev),
    tickets: tickets.map(t => ({ wallet: nm(t.wallet), tickets: t.tickets })), lastBuyer: nm(lastBuyer) ?? null,
    trades: (trades ?? []).map(t => ({ ...t, wallet: nm(t.wallet) })).reverse(),
    chat: (chat ?? []).map(c => ({ ...c, wallet: c.is_ringmaster ? c.wallet : c.source === 'pumpfun' ? (c.author || 'pump.fun') : nm(c.wallet) })).reverse(),
    effects: (fx ?? []).map(e => ({ id: e.id, effect: e.effect, who: e.wallet === 'ringmaster' ? 'The Ringmaster' : nm(e.wallet), at: e.created_at })).reverse(),
    stats: { burned: Number(st.tokens_burned ?? 0), buyback: Number(st.sol_bought_back ?? 0), prizes: Number(st.sol_paid ?? 0), rounds: Number(st.rounds_played ?? 0) },
    jackpot: Number(st.jackpot_sol ?? 0), queue: Number(st.queue_sol ?? 0), reserve: Number(st.buyback_reserve_sol ?? 0),
    milestone: st.next_milestone_usd ? { mcap: Number(st.mcap_usd ?? 0), next: Number(st.next_milestone_usd) } : null,
    serverTime: Date.now(),
  };
  void raw; void cfgRows; void leaderboard; void history;
  return NextResponse.json(body, { headers: { 'Cache-Control': 'public, s-maxage=2, stale-while-revalidate=6' } });
}

async function slow() {
  const [{ data: cfgRows }, { data: snaps }] = await Promise.all([
    supabase.from('config').select('key,value').in('key', CFG_KEYS),
    supabase.from('snapshots').select('key,data').in('key', ['history', 'leaderboard', 'teams']),
  ]);
  const snap = (k: string) => snaps?.find(s => s.key === k)?.data as any;
  const leaderboard: any[] = snap('leaderboard') ?? [];
  const history: any[] = snap('history') ?? [];
  const wallets = [...new Set([...leaderboard.map(l => l.wallet), ...history.flatMap(r => [r.winner_wallet, r.last_buyer])].filter((w): w is string => !!w && w.length > 30))];
  const names = new Map<string, string>();
  for (let i = 0; i < wallets.length; i += 200) {
    const { data } = await supabase.from('profiles').select('wallet,nickname,x_handle').in('wallet', wallets.slice(i, i + 200));
    for (const p of data ?? []) names.set(p.wallet, p.x_handle ? '@' + p.x_handle : p.nickname);
  }
  const nm = (w: string | null | undefined) => (w && names.get(w)) || w;
  return NextResponse.json({
    config: Object.fromEntries((cfgRows ?? []).map(c => [c.key, c.value as any])), teams: snap('teams') ?? null,
    leaderboard: leaderboard.map(l => ({ ...l, wallet: nm(l.wallet), address: l.wallet })),
    history: history.map(r => ({
      round: r.id, type: B2T[r.balloon], cap: Number(r.capacity_sol), tickets: r.total_tickets, wallets: r.wallets, rinvio: r.phase === 'postponed',
      winner: nm(r.winner_wallet), winT: r.winner_tickets ?? 0, main: Number(r.prize_sol ?? 0) * 0.95, last: nm(r.last_buyer), bonus: r.last_buyer ? Number(r.prize_sol ?? 0) * 0.05 : 0,
    })),
  }, { headers: { 'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=60' } });
}
