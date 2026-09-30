import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySignedMessage, freshMessage } from '@/lib/verify';

/** Remove the X account: the wallet goes back to showing its nickname. */
export async function POST(req: Request) {
  const { wallet, message, signature } = await req.json();
  if (!freshMessage(message, 'xunlink', wallet) || !verifySignedMessage(wallet, message, signature))
    return NextResponse.json({ error: 'Signature check failed.' }, { status: 401 });
  const { error } = await supabaseAdmin().from('profiles').update({ x_id: null, x_handle: null, x_avatar: null, x_linked_at: null }).eq('wallet', wallet);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
