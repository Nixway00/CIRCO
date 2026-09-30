import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySignedMessage, freshMessage } from '@/lib/verify';

const int = (lo: number, hi: number) => (v: unknown) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const num = (lo: number, hi: number) => (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
/** Every setting the team can change, with the range that keeps the game sane. */
const EDITABLE: Record<string, (v: unknown) => boolean> = {
  ticket_price_tokens: int(1, 1_000_000_000),
  chat_min_tokens: int(0, 1_000_000_000),
  mission_bonus_tickets: int(0, 10),
  balloons: (v) => !!v && typeof v === 'object' && ['green', 'blue', 'red', 'gold'].every(k => {
    const b = (v as any)[k]; return b && num(0.001, 1000)(b.capacity_sol) && int(0, 1000)(b.weight) && int(1, 100000)(b.min_tickets);
  }),
  jackpot_share: num(0, 0.3),
  jackpot_chance: num(0, 0.2),
  fx_prices: (v) => !!v && typeof v === 'object' && ['fireworks', 'confetti', 'horn', 'tomato', 'goldrain'].every(k => int(1, 1_000_000_000)((v as any)[k])),
  pick_price_tokens: int(1, 1_000_000_000),
  pick_return: num(0.1, 0.99),               // above 1 guessing would beat buying tickets
  game_price_tokens: int(1, 1_000_000_000),
  game_shots: int(1, 10),
  game_hit_chance: num(0, 0.9),
  game_daily_ticket_cap: int(0, 100),
  team_reward_tickets: int(0, 20),
  pumpfun_chat_relay: (v) => typeof v === 'boolean',
};

/** Team-only settings. The wallet must be listed in ADMIN_WALLETS and sign the request. */
export async function POST(req: Request) {
  const { wallet, message, signature, key, value } = await req.json();
  const admins = (process.env.ADMIN_WALLETS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!admins.includes(wallet)) return NextResponse.json({ error: 'Not an admin wallet.' }, { status: 403 });
  if (!freshMessage(message, 'admin', wallet) || !verifySignedMessage(wallet, message, signature))
    return NextResponse.json({ error: 'Signature check failed.' }, { status: 401 });
  if (!(key in EDITABLE)) return NextResponse.json({ error: 'This setting cannot be changed here.' }, { status: 400 });
  if (!EDITABLE[key](value)) return NextResponse.json({ error: 'That value is out of the allowed range.' }, { status: 400 });
  const { error } = await supabaseAdmin().from('config').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
