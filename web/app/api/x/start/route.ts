import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySignedMessage, freshMessage } from '@/lib/verify';
import { newPkce, authorizeUrl } from '@/lib/xauth';

/** Step 1 of linking X: the wallet signs "xlink:<wallet>:<time>", we send it to X to log in. */
export async function POST(req: Request) {
  if (!process.env.X_CLIENT_ID || !process.env.X_REDIRECT_URI) return NextResponse.json({ error: 'Linking X is not switched on yet.' }, { status: 503 });
  const { wallet, message, signature } = await req.json();
  if (!freshMessage(message, 'xlink', wallet) || !verifySignedMessage(wallet, message, signature))
    return NextResponse.json({ error: 'Signature check failed.' }, { status: 401 });
  const db = supabaseAdmin();
  const { data: profile } = await db.from('profiles').select('wallet').eq('wallet', wallet).maybeSingle();
  if (!profile) return NextResponse.json({ error: 'Choose a nickname first.' }, { status: 409 });
  const { verifier, challenge, state } = newPkce();
  await db.from('x_link_states').delete().lt('created_at', new Date(Date.now() - 15 * 60_000).toISOString());
  const { error } = await db.from('x_link_states').insert({ state, wallet, verifier });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ url: authorizeUrl(state, challenge) });
}
