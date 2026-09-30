import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySignedMessage, freshMessage } from '@/lib/verify';

const POST_URL = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/;

/**
 * Daily mission: paste the link to a post about a round, get bonus tickets once per UTC day.
 * One X account per wallet. Bonus tickets burn nothing but count toward the 10-ticket cap.
 * Optional before launch: confirm the post exists with one X API read ($0.005 per read).
 */
export async function POST(req: Request) {
  const { wallet, url, message, signature } = await req.json();
  if (!freshMessage(message, 'mission', wallet) || !verifySignedMessage(wallet, message, signature))
    return NextResponse.json({ error: 'Signature check failed.' }, { status: 401 });
  const m = String(url ?? '').trim().match(POST_URL);
  if (!m) return NextResponse.json({ error: 'That does not look like a link to a post on X.' }, { status: 400 });
  const handle = m[1].toLowerCase();
  const db = supabaseAdmin();

  const { data: link } = await db.from('x_links').select('handle').eq('wallet', wallet).maybeSingle();
  if (link && link.handle !== handle) return NextResponse.json({ error: `This wallet is linked to @${link.handle}. One X account per wallet.` }, { status: 409 });
  if (!link) {
    const { error } = await db.from('x_links').insert({ wallet, handle });
    if (error) return NextResponse.json({ error: 'That X account is already linked to another wallet.' }, { status: 409 });
  }

  const day = new Date().toISOString().slice(0, 10);
  const { data: done } = await db.from('mission_claims').select('wallet').eq('wallet', wallet).eq('day_utc', day).maybeSingle();
  if (done) return NextResponse.json({ error: 'Done for today. Come back tomorrow.' }, { status: 409 });

  const { data: round } = await db.from('rounds').select('id').in('phase', ['inflate', 'countdown']).order('id', { ascending: false }).limit(1).maybeSingle();
  if (!round) return NextResponse.json({ error: 'Ticket sales are closed right now.' }, { status: 409 });
  const { data: cfg } = await db.from('config').select('key,value').in('key', ['mission_bonus_tickets', 'max_tickets_per_wallet']);
  const bonus = Number(cfg?.find(c => c.key === 'mission_bonus_tickets')?.value ?? 3);
  const cap = Number(cfg?.find(c => c.key === 'max_tickets_per_wallet')?.value ?? 10);
  const { data: held } = await db.from('tickets').select('count').eq('round_id', round.id).eq('wallet', wallet);
  const have = (held ?? []).reduce((a, t) => a + t.count, 0);
  const give = Math.max(0, Math.min(bonus, cap - have));
  if (!give) return NextResponse.json({ error: 'You already hold 10 tickets this round. Claim in the next round.' }, { status: 409 });

  await db.from('tickets').insert({ round_id: round.id, wallet, count: give, kind: 'mission' });
  await db.from('mission_claims').insert({ wallet, day_utc: day, post_url: m[0], round_id: round.id, tickets: give });
  return NextResponse.json({ ok: true, tickets: give, round: round.id });
}
