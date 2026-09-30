import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySignedMessage, freshMessage, circoBalance } from '@/lib/verify';

/** Anyone reads the chat; only wallets holding the chat minimum of $CIRCO can write. */
export async function POST(req: Request) {
  const { wallet, body, message, signature } = await req.json();
  const text = String(body ?? '').trim();
  if (!text || text.length > 120) return NextResponse.json({ error: 'Messages are 1 to 120 characters.' }, { status: 400 });
  if (!freshMessage(message, 'chat', wallet) || !verifySignedMessage(wallet, message, signature))
    return NextResponse.json({ error: 'Signature check failed.' }, { status: 401 });
  const db = supabaseAdmin();
  const { data: cfg } = await db.from('config').select('value').eq('key', 'chat_min_tokens').single();
  const min = Number(cfg?.value ?? 10000);
  if ((await circoBalance(wallet)) < min) return NextResponse.json({ error: `Hold ${min.toLocaleString('en-US')} $CIRCO to chat.` }, { status: 403 });
  const { error } = await db.from('chat_messages').insert({ wallet, body: text });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
