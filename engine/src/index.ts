// $CIRCO game engine: the only process that writes game state and moves prize funds.
import express from 'express';
import { randomBytes } from 'node:crypto';
import { env } from './env.ts';
import { db, loadConfig, currentRound, ticketTotals, prizeCollected } from './db.ts';
import { pickBalloon, isGalaDue, step, allowedTickets, commit, drawSeed, pickWinner, lastBuyer, splitPrize, type Config, type BalloonKey } from './rules.ts';
import { verifyTicketBurn, paySol, closingBlock } from './chain.ts';
import { distributeCreatorFees } from './fees.ts';
import { runBuyback } from './buyback.ts';
import { postPop } from './xpost.ts';

let cfg: Config;
let busy = false;

// ---------- rounds ----------
async function startRound(opts: { carried_sol?: number; carryTicketsFrom?: number; postpone_streak?: number } = {}) {
  const { count } = await db.from('rounds').select('id', { count: 'exact', head: true });
  const { data: lastGold } = await db.from('rounds').select('started_at').eq('balloon', 'gold').order('id', { ascending: false }).limit(1).maybeSingle();
  const now = Date.now();
  const galaDue = isGalaDue(now, lastGold ? Date.parse(lastGold.started_at) : null, cfg.gala_check_utc_hour);
  const balloon: BalloonKey = pickBalloon((count ?? 0) + 1, galaDue, cfg, Math.random);
  const carried = opts.carried_sol ?? 0;
  const secret = randomBytes(32).toString('hex');
  const { data: round, error } = await db.from('rounds').insert({
    balloon, capacity_sol: cfg.balloons[balloon].capacity_sol + carried, carried_sol: carried,
    collected_sol: carried, postpone_streak: opts.postpone_streak ?? 0, forced_gala: galaDue && balloon === 'gold',
    seed_commit: commit(secret),
  }).select().single();
  if (error) throw error;
  await db.from('round_secrets').insert({ round_id: round.id, secret });
  if (opts.carryTicketsFrom) {
    const totals = await ticketTotals(opts.carryTicketsFrom);
    if (totals.length) await db.from('tickets').insert(totals.map(t => ({ round_id: round.id, wallet: t.wallet, count: t.tickets, kind: 'carried' })));
  }
  await ringmaster(balloon === 'gold' ? 'GOLD TROPHY. Five SOL. Seatbelts on, degens, it is gala night.' : `Round ${round.id}. Fresh balloon, fresh hopium.`);
  console.log(`round ${round.id} started: ${balloon}`);
}

async function ringmaster(body: string) {
  await db.from('chat_messages').insert({ wallet: 'Ringmaster', body: body.slice(0, 120), is_ringmaster: true });
}

async function tick() {
  if (busy) return; busy = true;
  try {
    const r = await currentRound();
    if (!r) { await startRound(); return; }
    r.collected_sol = await prizeCollected(r.id, r.carried_sol);
    await db.from('rounds').update({ collected_sol: r.collected_sol }).eq('id', r.id);
    const totals = await ticketTotals(r.id);
    const count = totals.reduce((a, t) => a + t.tickets, 0);
    const action = step(r, Date.now(), count, cfg);

    if (action.type === 'start_countdown') {
      await db.from('rounds').update({ phase: 'countdown', countdown_ends_at: new Date(action.ends_at).toISOString(), capacity_sol: action.capacity_sol }).eq('id', r.id);
      await ringmaster(action.reason === 'full' ? 'It is full. Three minutes. Last ticket takes 5%, snipers to your stations.' : '30 minutes and still not full. Fine, we pop what we have.');
    }
    if (action.type === 'extend') {
      await db.from('rounds').update({ countdown_ends_at: new Date(action.ends_at).toISOString(), extensions: action.extensions }).eq('id', r.id);
      await ringmaster(`Not enough tickets yet. One more minute (${action.extensions} of ${cfg.max_extensions}).`);
    }
    if (action.type === 'postpone') {
      await db.from('rounds').update({ phase: 'postponed', ended_at: new Date().toISOString() }).eq('id', r.id);
      await ringmaster('Not enough tickets. The balloon flies to the next round, and so does your hopium.');
      await startRound({ carried_sol: r.capacity_sol, carryTicketsFrom: r.id, postpone_streak: r.postpone_streak + 1 });
    }
    if (action.type === 'close_and_draw') await draw(r.id, r.capacity_sol, action.forced);
  } catch (e) { console.error(e); } finally { busy = false; }
}

async function draw(roundId: number, prize: number, forced: boolean) {
  await db.from('rounds').update({ phase: 'drawing' }).eq('id', roundId);
  const { slot, blockhash } = await closingBlock();
  const { data: sec } = await db.from('round_secrets').select('secret').eq('round_id', roundId).single();
  const seed = drawSeed(sec!.secret, blockhash, roundId);
  const totals = await ticketTotals(roundId);
  const win = pickWinner(totals, seed);
  const last = lastBuyer(await ticketTotals(roundId, true));
  const split = splitPrize(prize, cfg);
  const winnerTx = await paySol(win.wallet, last ? split.winner : prize);
  const bonusTx = last ? await paySol(last, split.bonus) : null;
  await db.from('rounds').update({
    phase: 'done', ended_at: new Date().toISOString(), close_slot: slot, close_blockhash: blockhash, seed_secret: sec!.secret,
    winner_wallet: win.wallet, winner_tickets: totals.find(t => t.wallet === win.wallet)?.tickets ?? 0, last_buyer: last,
    prize_sol: prize, winner_payout_tx: winnerTx, bonus_payout_tx: bonusTx,
  }).eq('id', roundId);
  const msg = `${short(win.wallet)} just took ${split.winner} SOL. Screenshot it, frame it, tell your mom.`;
  await ringmaster(forced ? `Three postponements in a row, so we drew anyway. ${msg}` : msg);
  await postPop(`POP. Round ${roundId}: ${short(win.wallet)} won ${split.winner} SOL with ${win.total} tickets in play.${last ? ` Last-ticket bonus to ${short(last)}.` : ''} $CIRCO, the 24/7 memecoin circus.`);
  await startRound();
}
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

// ---------- HTTP: tickets from the site, fees and trades from Helius ----------
const app = express();
app.use(express.json({ limit: '2mb' }));

app.post('/tickets/confirm', async (req, res) => {
  if (req.get('x-engine-secret') !== env.ENGINE_API_SECRET) return res.status(401).end();
  try {
    const { signature } = req.body as { signature: string };
    const burn = await verifyTicketBurn(signature, cfg.ticket_price_tokens);
    const r = await currentRound();
    if (!r || r.id !== burn.roundId || r.phase === 'drawing') return res.status(409).json({ error: 'sales closed for that round' });
    if (r.phase === 'countdown' && r.countdown_ends_at && burn.blockTime > r.countdown_ends_at) return res.status(409).json({ error: 'burn landed after sales closed' });
    const held = (await ticketTotals(r.id)).find(t => t.wallet === burn.wallet)?.tickets ?? 0;
    const ok = allowedTickets(burn.tickets, held, cfg);
    if (ok < burn.tickets) return res.status(409).json({ error: 'over the 10-ticket cap' });
    const { error } = await db.from('tickets').insert({ round_id: r.id, wallet: burn.wallet, count: burn.tickets, kind: 'burn', burn_tx: signature, tokens_burned: burn.tokens.toString() });
    if (error) return res.status(409).json({ error: error.message });   // duplicate signature, etc.
    res.json({ ok: true, round: r.id, tickets: held + burn.tickets });
  } catch (e) { res.status(400).json({ error: (e as Error).message }); }
});

// Helius "enhanced" webhook: SOL landing on the prize wallet = fees; swaps on the pool = live feed
app.post('/helius', async (req, res) => {
  if (req.get('authorization') !== env.HELIUS_WEBHOOK_SECRET) return res.status(401).end();
  const events = Array.isArray(req.body) ? req.body : [req.body];
  const r = await currentRound();
  for (const ev of events) {
    for (const nt of ev.nativeTransfers ?? []) {
      if (nt.toUserAccount === env.PRIZE_WALLET_ADDRESS && nt.amount > 0) {
        await db.from('fees').upsert({ tx: ev.signature, wallet: 'prize', amount_sol: nt.amount / 1e9, round_id: r?.id ?? null }, { onConflict: 'tx' });
      }
    }
    if (ev.type === 'SWAP' && ev.feePayer) {
      const sol = Math.abs((ev.nativeTransfers ?? []).reduce((a: number, t: any) => a + (t.fromUserAccount === ev.feePayer ? -t.amount : t.toUserAccount === ev.feePayer ? t.amount : 0), 0)) / 1e9;
      const side = (ev.tokenTransfers ?? []).some((t: any) => t.toUserAccount === ev.feePayer && t.mint === env.CIRCO_MINT) ? 'buy' : 'sell';
      await db.from('trades').upsert({ tx: ev.signature, wallet: ev.feePayer, side, amount_sol: sol }, { onConflict: 'tx' });
    }
  }
  res.json({ ok: true });
});

// ---------- boot ----------
cfg = await loadConfig();
setInterval(async () => { cfg = await loadConfig(); }, 60_000);  // team can change config live
setInterval(tick, 1000);
setInterval(() => { distributeCreatorFees().then(r => r && console.log('fees distributed', r)).catch(e => console.error('fee distribution failed', e)); }, 30_000);
setInterval(() => { runBuyback().catch(e => console.error('buyback failed', e)); }, 10 * 60_000);
app.listen(env.PORT, () => console.log(`engine on :${env.PORT}`));
