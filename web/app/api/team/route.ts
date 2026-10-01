import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySignedMessage, freshMessage } from '@/lib/verify';

/** Switch team. Signed message "team:<wallet>:<time>:<clowns|acrobats>". Once a week. */
export async function POST(req: Request) {
  try { return await handle(req); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

async function handle(req: Request) {
  const { wallet, message, signature } = await req.json();
  if (!freshMessage(message, 'team', wallet) || !verifySignedMessage(wallet, message, signature))
    return NextResponse.json({ error: 'Signature check failed.' }, { status: 401 });
  const team = String(message).split(':')[3];
  if (team !== 'clowns' && team !== 'acrobats') return NextResponse.json({ error: 'Unknown team.' }, { status: 400 });
  const db = supabaseAdmin();
  const { data: prof } = await db.from('profiles').select('team,team_set_at').eq('wallet', wallet).maybeSingle();
  if (!prof) return NextResponse.json({ error: 'Choose a nickname first.' }, { status: 409 });
  if (prof.team && prof.team !== team && prof.team_set_at && Date.now() - Date.parse(prof.team_set_at) < 7 * 86400_000)
    return NextResponse.json({ error: 'You can switch team once a week.' }, { status: 429 });
  const { error } = await db.from('profiles').update({ team, team_set_at: new Date().toISOString() }).eq('wallet', wallet);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, team });
}
