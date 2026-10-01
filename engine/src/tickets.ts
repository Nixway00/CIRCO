import { db, openRound, addTickets, type AddResult } from './db.ts';
import { verifyTicketBurn } from './chain.ts';
import { placeBurn, snipeExtension, type Config } from './rules.ts';

/**
 * The single path for a ticket purchase, used both by the site (/tickets/confirm) and by the
 * Helius webhook, so a burn is counted even if the buyer closes the browser. Idempotent.
 */
export async function processBurn(signature: string, cfg: Config): Promise<AddResult & { roundId: number | null; wallet: string }> {
  const c: any = cfg;
  const prevOk = Number(c.ticket_price_prev ?? 0) > 0 && Date.now() - Number(c.ticket_price_changed_at ?? 0) < 15 * 60_000;
  const burn = await verifyTicketBurn(signature, cfg.ticket_price_tokens, prevOk ? Number(c.ticket_price_prev) : 0);
  const open = await openRound();
  const place = placeBurn(burn.roundId, burn.blockTime, open ? { id: open.id, phase: open.phase, countdown_ends_at: open.countdown_ends_at } : null);
  const res = await addTickets(place.roundId, burn.wallet, burn.tickets, place.kind, signature, burn.tokens.toString(), cfg.max_tickets_per_wallet);
  // the on-chain order decides the last-ticket bonus, not the order in which the engine happened to see the burns
  if (res.given > 0) await db.from('tickets').update({ burn_slot: burn.slot }).eq('burn_tx', signature);
  // the last-ticket war: a purchase in the final seconds pushes the end back (on-chain time decides)
  if (res.given > 0 && place.kind === 'burn' && open && open.phase === 'countdown' && open.countdown_ends_at) {
    const { data: r } = await db.from('rounds').select('countdown_ends_at,snipe_base,snipes').eq('id', open.id).single();
    const ext = r && snipeExtension(Date.parse(r.countdown_ends_at), burn.blockTime, r.snipe_base ? Date.parse(r.snipe_base) : null, cfg);
    if (ext) {
      const { data: moved } = await db.from('rounds').update({ countdown_ends_at: new Date(ext.endsAt).toISOString(), snipe_base: new Date(ext.warBase).toISOString(), snipes: (r!.snipes ?? 0) + 1 })
        .eq('id', open.id).eq('phase', 'countdown').lt('countdown_ends_at', new Date(ext.endsAt).toISOString()).select('id');
      if (moved?.length && (r!.snipes ?? 0) % 3 === 0) await db.from('chat_messages').insert({ wallet: 'Ringmaster', is_ringmaster: true, body: pickLine((r!.snipes ?? 0)) });
    }
  }
  return { ...res, roundId: place.roundId, wallet: burn.wallet };
}

const WAR_LINES = ['A sniper! The clock jumps back. Who wants the last ticket?', 'Another one! +15 seconds. This is war, people.', 'They keep coming. Fingers on the button!', 'The last-ticket war is ON. Nobody blinks.'];
function pickLine(n: number) { return WAR_LINES[Math.floor(n / 3) % WAR_LINES.length]; }

/** At the start of a round, hand out stored credits (up to the cap) and take them off each balance. */
export async function grantCredits(roundId: number, cfg: Config) {
  const { data, error } = await db.from('ticket_credits').select('wallet,tickets').gt('tickets', 0);
  if (error) throw error;
  for (const c of data ?? []) {
    const r = await addTickets(roundId, c.wallet, Math.min(c.tickets, cfg.max_tickets_per_wallet), 'credit', null, '0', cfg.max_tickets_per_wallet);
    if (r.given > 0) {
      const { error: e2 } = await db.rpc('consume_credit', { p_wallet: c.wallet, p_n: r.given });
      if (e2) throw e2;
    }
  }
}
