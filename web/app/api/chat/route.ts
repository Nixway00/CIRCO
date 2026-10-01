import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySignedMessage, freshMessage, circoBalance } from '@/lib/verify';
import { chatProblem } from '@/lib/chatGuard';

/** Anyone reads the chat; only wallets holding the chat minimum of $CIRCO can write. */
export async function POST(req: Request) {
  try { return await handle(req); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

async function handle(req: Request) {
  const { wallet, body, message, signature } = await req.json();
  const text = String(body ?? '').trim();
  if (!text || text.length > 120) return NextResponse.json({ error: 'Messages are 1 to 120 characters.' }, { status: 400 });
  const problem = chatProblem(text);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (!freshMessage(message, 'chat', wallet) || !verifySignedMessage(wallet, message, signature))
    return NextResponse.json({ error: 'Signature check failed.' }, { status: 401 });
  const db = supabaseAdmin();
  // a nickname is required to write (the stage asks for it; the server makes sure)
  const { data: prof } = await db.from('profiles').select('wallet').eq('wallet', wallet).maybeSingle();
  if (!prof) return NextResponse.json({ error: 'Choose a nickname first.' }, { status: 403 });
  const { data: cfg } = await db.from('config').select('value').eq('key', 'chat_min_tokens').single();
  const min = Number(cfg?.value ?? 10000);
  if ((await circoBalance(wallet)) < min) return NextResponse.json({ error: `Hold ${min.toLocaleString('en-US')} $CIRCO to chat.` }, { status: 403 });
  // anti-spam: one message every 4 seconds per wallet, no repeating the same line within a minute
  const { data: last } = await db.from('chat_messages').select('body,created_at').eq('wallet', wallet).order('id', { ascending: false }).limit(1).maybeSingle();
  if (last) {
    const age = Date.now() - Date.parse(last.created_at);
    if (age < 4_000) return NextResponse.json({ error: 'Slow down: one message every few seconds.' }, { status: 429 });
    if (age < 60_000 && last.body.trim().toLowerCase() === text.toLowerCase()) return NextResponse.json({ error: 'You just said that.' }, { status: 429 });
  }
  const { error } = await db.from('chat_messages').insert({ wallet, body: text });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
