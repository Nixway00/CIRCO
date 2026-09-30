import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySignedMessage, freshMessage } from '@/lib/verify';

const RESERVED = ['ringmaster', 'admin', 'team', 'circo', 'moderator', 'mod', 'support', 'official', 'pumpfun', 'solana'];

/** Set or change the wallet's nickname. The signed message is "nickname:<wallet>:<time>:<nickname>". */
export async function POST(req: Request) {
  const { wallet, message, signature } = await req.json();
  if (!freshMessage(message, 'nickname', wallet) || !verifySignedMessage(wallet, message, signature))
    return NextResponse.json({ error: 'Signature check failed.' }, { status: 401 });
  const nickname = String(message).split(':')[3] ?? '';
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nickname)) return NextResponse.json({ error: '3 to 16 characters: letters, numbers or _.' }, { status: 400 });
  if (RESERVED.some(r => nickname.toLowerCase().includes(r))) return NextResponse.json({ error: 'That nickname is reserved.' }, { status: 400 });

  const db = supabaseAdmin();
  const { data: cur } = await db.from('profiles').select('nickname,updated_at').eq('wallet', wallet).maybeSingle();
  if (cur && cur.nickname !== nickname && Date.now() - Date.parse(cur.updated_at) < 24 * 3600_000)
    return NextResponse.json({ error: 'You can change your nickname once a day.' }, { status: 429 });
  const { error } = await db.from('profiles').upsert({ wallet, nickname, updated_at: new Date().toISOString() }, { onConflict: 'wallet' });
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'That nickname is taken.' : error.message }, { status: 409 });
  return NextResponse.json({ ok: true, nickname });
}
