// $CIRCO game engine: the only process that writes game state and moves prize funds.
// Every step is written so that a crash or restart at any point resumes safely.
import express from 'express';
import { randomBytes } from 'node:crypto';
import { env } from './env.ts';
import { db, loadConfig, openRound, drawingRound, ticketTotals, prizeCollected, type Round } from './db.ts';
import { pickBalloon, isGalaDue, step, commit, drawSeed, pickWinner, lastBuyer, payoutPlan, overflowOnFull, feeTargetsCurrentRound, LAMPORTS, type Config, type BalloonKey } from './rules.ts';
import { closingBlock } from './chain.ts';
import { planPayouts, settlePayouts } from './payouts.ts';
import { processBurn, grantCredits } from './tickets.ts';
import { refreshSnapshots } from './snapshots.ts';
import { startGame, playGame, settleGameFromBurn, type GameConfig } from './games.ts';
import { distributeCreatorFees } from './fees.ts';
import { runBuyback } from './buyback.ts';
import { postPop } from './xpost.ts';

let cfg: Config & GameConfig;
let busy = false;
const MEMO_PROGRAMS = new Set(['MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVuDwQkkHtCv']);
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const sol = (lamports: number) => String(Number((lamports / LAMPORTS).toFixed(4)));

async function ok(p: PromiseLike<{ error: any }>): Promise<void> {
  const { error } = await p;
  if (error) throw error;
}
async function must<T>(p: PromiseLike<{ data: T; error: any }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error('no data');
  return data as NonNullable<T>;
}

// ---------- rounds ----------
async function startRound(opts: { carried_sol?: number; carryTicketsFrom?: number; postpone_streak?: number } = {}) {
  const { count } = await db.from('rounds').select('id', { count: 'exact', head: true });
  const { data: lastGold, error: gErr } = await db.from('rounds').select('started_at').eq('balloon', 'gold').order('id', { ascending: false }).limit(1).maybeSingle();
  if (gErr) throw gErr;
  const galaDue = isGalaDue(Date.now(), lastGold ? Date.parse(lastGold.started_at) : null, cfg.gala_check_utc_hour);
  const balloon: BalloonKey = pickBalloon((count ?? 0) + 1, galaDue, cfg, Math.random);

  // SOL that overflowed full balloons is added to what this balloon starts with
  const pending = await must(db.from('rounds').select('id,overflow_sol').eq('overflow_pending', true));
  const overflow = (pending ?? []).reduce((a, r) => a + Number(r.overflow_sol), 0);
  const postponed = opts.carried_sol ?? 0;
  const carried = postponed + overflow;

  const secret = randomBytes(32).toString('hex');
  const round = await must(db.from('rounds').insert({
    balloon, capacity_sol: cfg.balloons[balloon].capacity_sol + postponed, carried_sol: carried,
    collected_sol: carried, postpone_streak: opts.postpone_streak ?? 0, forced_gala: galaDue && balloon === 'gold',
    seed_commit: commit(secret),
  }).select().single());
  await ok(db.from('round_secrets').insert({ round_id: round.id, secret }));
  if (pending?.length) await ok(db.from('rounds').update({ overflow_pending: false }).in('id', pending.map(p => p.id)));
  // fees that arrived while the previous balloon was counting down or being drawn belong here
  await ok(db.from('fees').update({ round_id: round.id }).is('round_id', null).eq('wallet', 'prize'));

  if (opts.carryTicketsFrom) {
    const totals = await ticketTotals(opts.carryTicketsFrom);
    for (const t of totals) await db.rpc('add_tickets', { p_round: round.id, p_wallet: t.wallet, p_count: t.tickets, p_kind: 'carried', p_burn_tx: null, p_tokens: '0', p_cap: 1_000_000 });
  }
  await grantCredits(round.id, cfg);
  await ringmaster(balloon === 'gold' ? 'GOLD TROPHY. Five SOL. Seatbelts on, degens, it is gala night.' : `Round ${round.id}. Fresh balloon, fresh hopium.`);
  console.log(`round ${round.id} started: ${balloon}, carried ${carried} SOL`);
}

async function ringmaster(body: string) {
  await db.from('chat_messages').insert({ wallet: 'Ringmaster', body: body.slice(0, 120), is_ringmaster: true });
}

async function tick() {
  if (busy) return; busy = true;
  try {
    // 1. an unfinished draw always comes first (engine restarted mid-draw, payment still in flight, …)
    const d = await drawingRound();
    if (d) { await continueDraw(d); return; }

    const r = await openRound();
    if (!r) { await startRound(); return; }
    if (r.phase === 'inflate') {
      r.collected_sol = await prizeCollected(r.id, r.carried_sol);
      await ok(db.from('rounds').update({ collected_sol: r.collected_sol }).eq('id', r.id));
    }
    const totals = await ticketTotals(r.id);
    const count = totals.reduce((a, t) => a + t.tickets, 0);
    const action = step(r, Date.now(), count, cfg);

    if (action.type === 'start_countdown') {
      const overflow = action.reason === 'full' ? overflowOnFull(r.collected_sol, r.capacity_sol) : 0;
      await ok(db.from('rounds').update({
        phase: 'countdown', countdown_ends_at: new Date(action.ends_at).toISOString(), capacity_sol: action.capacity_sol,
        overflow_sol: overflow, overflow_pending: overflow > 0,
      }).eq('id', r.id));
      await ringmaster(action.reason === 'full' ? 'It is full. Three minutes. Last ticket takes 5%, snipers to your stations.' : '30 minutes and still not full. Fine, we pop what we have.');
    }
    if (action.type === 'extend') {
      await ok(db.from('rounds').update({ countdown_ends_at: new Date(action.ends_at).toISOString(), extensions: action.extensions }).eq('id', r.id));
      await ringmaster(`Not enough tickets yet. One more minute (${action.extensions} of ${cfg.max_extensions}).`);
    }
    if (action.type === 'postpone') {
      await ok(db.from('rounds').update({ phase: 'postponed', ended_at: new Date().toISOString() }).eq('id', r.id));
      await ringmaster('Not enough tickets. The balloon flies to the next round, and so does your hopium.');
      await startRound({ carried_sol: r.capacity_sol, carryTicketsFrom: r.id, postpone_streak: r.postpone_streak + 1 });
    }
    if (action.type === 'close_and_draw') {
      await ok(db.from('rounds').update({ phase: 'drawing' }).eq('id', r.id));
      const fresh = await drawingRound();
      if (fresh) await continueDraw(fresh, action.forced);
    }
  } catch (e) { console.error('tick failed', e); } finally { busy = false; }
}

/**
 * Resumable draw: (1) pick and store the winner once, (2) store the payments, (3) push each payment
 * forward safely, (4) close the round only when every payment is confirmed.
 */
async function continueDraw(r: Round, forced = false) {
  if (!r.winner_wallet) {
    const { slot, blockhash } = await closingBlock();
    const sec = await must(db.from('round_secrets').select('secret').eq('round_id', r.id).single());
    const totals = await ticketTotals(r.id);
    const win = pickWinner(totals, drawSeed(sec.secret, blockhash, r.id));
    const last = lastBuyer(await ticketTotals(r.id, true));
    await ok(db.from('rounds').update({
      close_slot: slot, close_blockhash: blockhash, seed_secret: sec.secret, winner_wallet: win.wallet,
      winner_tickets: totals.find(t => t.wallet === win.wallet)?.tickets ?? 0, last_buyer: last,
      prize_sol: r.capacity_sol, draw_total_tickets: win.total,
    }).eq('id', r.id).is('winner_wallet', null));
    const stored = await drawingRound();
    if (!stored || !stored.winner_wallet) return;
    r = stored;
    const plan = payoutPlan(Number(r.prize_sol), r.last_buyer, cfg);
    await planPayouts(r.id, [
      { kind: 'winner', wallet: r.winner_wallet!, lamports: plan.winner },
      ...(r.last_buyer ? [{ kind: 'bonus' as const, wallet: r.last_buyer, lamports: plan.bonus }] : []),
    ]);
    await ringmaster(`${forced ? 'Three postponements in a row, so we draw anyway. ' : ''}The wheel has spoken. Paying out now…`);
  }

  if (!(await settlePayouts(r.id))) return;   // try again next tick

  const payouts = await must(db.from('payouts').select('kind,signature,lamports').eq('round_id', r.id));
  const w = payouts.find(p => p.kind === 'winner'), b = payouts.find(p => p.kind === 'bonus');
  await ok(db.from('rounds').update({
    phase: 'done', ended_at: new Date().toISOString(), winner_payout_tx: w?.signature ?? null, bonus_payout_tx: b?.signature ?? null,
  }).eq('id', r.id).eq('phase', 'drawing'));
  const won = sol(Number(w?.lamports ?? 0));
  await ringmaster(`${short(r.winner_wallet!)} just took ${won} SOL. Screenshot it, frame it, tell your mom.`);
  postPop(`POP. Round ${r.id}: ${short(r.winner_wallet!)} won ${won} SOL with ${r.draw_total_tickets ?? 0} tickets in play.${r.last_buyer ? ` Last-ticket bonus to ${short(r.last_buyer)}.` : ''} $CIRCO, the 24/7 memecoin circus.`)
    .catch(e => console.error('X post failed', e));
  await startRound();
}

// ---------- HTTP: tickets from the site, fees, trades and burns from Helius ----------
const app = express();
app.use(express.json({ limit: '2mb' }));

app.post('/tickets/confirm', async (req, res) => {
  if (req.get('x-engine-secret') !== env.ENGINE_API_SECRET) return res.status(401).end();
  try {
    const { signature } = req.body as { signature: string };
    const r = await processBurn(signature, cfg);
    const held = r.roundId ? (await ticketTotals(r.roundId)).find(t => t.wallet === r.wallet)?.tickets ?? 0 : 0;
    res.json({ ok: true, round: r.roundId, given: r.given, credited: r.credited, duplicate: r.duplicate, tickets: held });
  } catch (e) { res.status(400).json({ error: (e as Error).message }); }
});

// Helius enhanced webhook: SOL landing on the prize wallet = fees; swaps = live feed; memo burns = tickets
app.post('/helius', async (req, res) => {
  if (req.get('authorization') !== env.HELIUS_WEBHOOK_SECRET) return res.status(401).end();
  const events = Array.isArray(req.body) ? req.body : [req.body];
  try {
    const r = await openRound();
    const feeRound = r && feeTargetsCurrentRound(r.phase) ? r.id : null;   // null = waits for the next round
    for (const ev of events) {
      for (const nt of ev.nativeTransfers ?? []) {
        if (nt.toUserAccount === env.PRIZE_WALLET_ADDRESS && nt.amount > 0) {
          await db.from('fees').upsert({ tx: ev.signature, wallet: 'prize', amount_sol: nt.amount / LAMPORTS, round_id: feeRound }, { onConflict: 'tx', ignoreDuplicates: true });
        }
      }
      if (ev.type === 'SWAP' && ev.feePayer) {
        const amt = Math.abs((ev.nativeTransfers ?? []).reduce((a: number, t: any) => a + (t.fromUserAccount === ev.feePayer ? -t.amount : t.toUserAccount === ev.feePayer ? t.amount : 0), 0)) / LAMPORTS;
        const side = (ev.tokenTransfers ?? []).some((t: any) => t.toUserAccount === ev.feePayer && t.mint === env.CIRCO_MINT) ? 'buy' : 'sell';
        await db.from('trades').upsert({ tx: ev.signature, wallet: ev.feePayer, side, amount_sol: amt }, { onConflict: 'tx', ignoreDuplicates: true });
      }
      if ((ev.instructions ?? []).some((i: any) => MEMO_PROGRAMS.has(i.programId))) {
        processBurn(ev.signature, cfg).catch(() => {});         // not a ticket burn, or already counted: ignore
        settleGameFromBurn(ev.signature, cfg).catch(() => {});  // not a game burn, or already played: ignore
      }
    }
  } catch (e) { console.error('webhook failed', e); return res.status(500).end(); }   // Helius retries
  res.json({ ok: true });
});

// shooting gallery: start commits to a secret, play settles it with the player's burn
app.post('/games/start', async (req, res) => {
  if (req.get('x-engine-secret') !== env.ENGINE_API_SECRET) return res.status(401).end();
  try { res.json(await startGame(String(req.body.wallet), cfg)); } catch (e) { res.status(409).json({ error: (e as Error).message }); }
});
app.post('/games/play', async (req, res) => {
  if (req.get('x-engine-secret') !== env.ENGINE_API_SECRET) return res.status(401).end();
  try { res.json(await playGame(String(req.body.id), String(req.body.signature), cfg)); } catch (e) { res.status(400).json({ error: (e as Error).message }); }
});

app.get('/health', (_req, res) => res.json({ ok: true, busy }));

// ---------- boot ----------
cfg = (await loadConfig()) as Config & GameConfig;
setInterval(async () => { try { cfg = (await loadConfig()) as Config & GameConfig; } catch (e) { console.error('config reload failed', e); } }, 60_000);
setInterval(tick, 1000);
setInterval(() => { refreshSnapshots().catch(e => console.error('snapshots failed', e)); }, 15_000);
setInterval(() => { distributeCreatorFees().then(r => r && console.log('fees distributed', r)).catch(e => console.error('fee distribution failed', e)); }, 30_000);
setInterval(() => { runBuyback().catch(e => console.error('buyback failed', e)); }, 10 * 60_000);
refreshSnapshots().catch(() => {});
app.listen(env.PORT, () => console.log(`engine on :${env.PORT}`));
