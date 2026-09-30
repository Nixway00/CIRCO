import { db, openRound, addTickets, type AddResult } from './db.ts';
import { verifyTicketBurn } from './chain.ts';
import { placeBurn, type Config } from './rules.ts';

/**
 * The single path for a ticket purchase, used both by the site (/tickets/confirm) and by the
 * Helius webhook, so a burn is counted even if the buyer closes the browser. Idempotent.
 */
export async function processBurn(signature: string, cfg: Config): Promise<AddResult & { roundId: number | null; wallet: string }> {
  const burn = await verifyTicketBurn(signature, cfg.ticket_price_tokens);
  const open = await openRound();
  const place = placeBurn(burn.roundId, burn.blockTime, open ? { id: open.id, phase: open.phase, countdown_ends_at: open.countdown_ends_at } : null);
  const res = await addTickets(place.roundId, burn.wallet, burn.tickets, place.kind, signature, burn.tokens.toString(), cfg.max_tickets_per_wallet);
  // the on-chain order decides the last-ticket bonus, not the order in which the engine happened to see the burns
  if (res.given > 0) await db.from('tickets').update({ burn_slot: burn.slot }).eq('burn_tx', signature);
  return { ...res, roundId: place.roundId, wallet: burn.wallet };
}

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
