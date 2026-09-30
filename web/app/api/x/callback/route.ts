import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exchangeCode, whoAmI } from '@/lib/xauth';

/** Step 2: X sends the user back here. We read who they are and attach the X account to the wallet. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (result: string) => NextResponse.redirect(new URL(`/?x=${encodeURIComponent(result)}`, url.origin));
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  if (!code || !state) return back('cancelled');
  const db = supabaseAdmin();
  const { data: pending } = await db.from('x_link_states').select('*').eq('state', state).maybeSingle();
  await db.from('x_link_states').delete().eq('state', state);
  if (!pending || Date.now() - Date.parse(pending.created_at) > 15 * 60_000) return back('expired');
  try {
    const me = await whoAmI(await exchangeCode(code, pending.verifier));
    const { data: taken } = await db.from('profiles').select('wallet').eq('x_id', me.id).maybeSingle();
    if (taken && taken.wallet !== pending.wallet) return back('taken');
    const { error } = await db.from('profiles').update({ x_id: me.id, x_handle: me.handle, x_avatar: me.avatar, x_linked_at: new Date().toISOString() }).eq('wallet', pending.wallet);
    if (error) return back('error');
    return back(`linked:${me.handle}`);
  } catch { return back('error'); }
}
