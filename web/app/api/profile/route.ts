import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySignedMessage, freshMessage } from '@/lib/verify';

const RESERVED = ['ringmaster', 'admin', 'team', 'circo', 'moderator', 'mod', 'support', 'official', 'pumpfun', 'solana'];

/** Set or change the wallet's nickname. The signed message is "nickname:<wallet>:<time>:<nickname>". */
export async function POST(req: Request) {
  try { return await handle(req); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

async function handle(req: Request) {
  const { wallet, message, signature } = await req.json();
  if (!freshMessage(message, 'nickname', wallet) || !verifySignedMessage(wallet, message, signature))
    return NextResponse.json({ error: 'Signature check failed.' }, { status: 401 });
  const parts = String(message).split(':');
  const nickname = parts[3] ?? '';
  const team = parts[4] === 'clowns' || parts[4] === 'acrobats' ? parts[4] : null;
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nickname)) return NextResponse.json({ error: '3 to 16 characters: letters, numbers or _.' }, { status: 400 });
  if (RESERVED.some(r => nickname.toLowerCase().includes(r))) return NextResponse.json({ error: 'That nickname is reserved.' }, { status: 400 });

  const db = supabaseAdmin();
  const { data: cur } = await db.from('profiles').select('nickname,updated_at,team').eq('wallet', wallet).maybeSingle();
  if (cur && cur.nickname !== nickname && Date.now() - Date.parse(cur.updated_at) < 24 * 3600_000)
    return NextResponse.json({ error: 'You can change your nickname once a day.' }, { status: 429 });
  const row: Record<string, unknown> = { wallet, nickname, updated_at: new Date().toISOString() };
  if (team && !cur?.team) { row.team = team; row.team_set_at = new Date().toISOString(); }   // first choice comes with the nickname
  const { error } = await db.from('profiles').upsert(row, { onConflict: 'wallet' });
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'That nickname is taken.' : error.message }, { status: 409 });
  return NextResponse.json({ ok: true, nickname });
}
