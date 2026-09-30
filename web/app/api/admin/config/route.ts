import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySignedMessage, freshMessage } from '@/lib/verify';

const EDITABLE = new Set(['ticket_price_tokens', 'chat_min_tokens', 'balloons', 'mission_bonus_tickets']);

/** Team-only settings. The wallet must be listed in ADMIN_WALLETS and sign the request. */
export async function POST(req: Request) {
  const { wallet, message, signature, key, value } = await req.json();
  const admins = (process.env.ADMIN_WALLETS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!admins.includes(wallet)) return NextResponse.json({ error: 'Not an admin wallet.' }, { status: 403 });
  if (!freshMessage(message, 'admin', wallet) || !verifySignedMessage(wallet, message, signature))
    return NextResponse.json({ error: 'Signature check failed.' }, { status: 401 });
  if (!EDITABLE.has(key)) return NextResponse.json({ error: 'This setting cannot be changed here.' }, { status: 400 });
  const { error } = await supabaseAdmin().from('config').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
