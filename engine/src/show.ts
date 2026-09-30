// The show features: paid stage effects, next-balloon predictions, weekly team battle.
import { db, openRound, addTickets } from './db.ts';
import { readBurn } from './chain.ts';
import { balloonOdds, pickPayout, weekStart, teamWinner, type Config, type BalloonKey } from './rules.ts';

const FX = ['fireworks', 'confetti', 'horn', 'tomato', 'goldrain'] as const;
const COLORS: BalloonKey[] = ['green', 'blue', 'red', 'gold'];
const whole = (raw: bigint, dec: number) => (raw / 10n ** BigInt(dec)).toString();

/** "CIRCO-FX:<effect>": burn exactly the effect price, the effect plays for everyone. Idempotent. */
export async function processFx(signature: string, cfg: Config) {
  const b = await readBurn(signature);
  const m = b.memo?.match(/^CIRCO-FX:([a-z]+)$/);
  if (!m || !(FX as readonly string[]).includes(m[1])) throw new Error('not an effect burn');
  const price = cfg.fx_prices?.[m[1]];
  if (!price) throw new Error('effect not for sale');
  if (b.burned !== BigInt(price) * 10n ** BigInt(b.decimals)) throw new Error('wrong amount for this effect');
  const { error } = await db.from('effects').upsert({ wallet: b.wallet, effect: m[1], burn_tx: signature, tokens: whole(b.burned, b.decimals) }, { onConflict: 'burn_tx', ignoreDuplicates: true });
  if (error) throw error;
  return { ok: true, effect: m[1] };
}

/**
 * "CIRCO-PICK:<roundId>:<color>": a guess on the colour of the NEXT balloon, made while the named
 * round is still selling. The payout is fixed when the guess is made. A guess that arrives too late,
 * or a second guess in the same round, is turned into one ticket credit (the stake's worth).
 */
export async function processPick(signature: string, cfg: Config) {
  const b = await readBurn(signature);
  const m = b.memo?.match(/^CIRCO-PICK:(\d+):(green|blue|red|gold)$/);
  if (!m) throw new Error('not a prediction burn');
  const price = cfg.pick_price_tokens ?? 10000;
  if (b.burned !== BigInt(price) * 10n ** BigInt(b.decimals)) throw new Error('wrong amount for a guess');
  const roundId = Number(m[1]), color = m[2] as BalloonKey;
  const { data: existing } = await db.from('predictions').select('id').eq('burn_tx', signature).maybeSingle();
  if (existing) return { ok: true, duplicate: true };

  const open = await openRound();
  const selling = !!open && open.id === roundId && (open.phase === 'inflate' || (open.phase === 'countdown' && (!open.countdown_ends_at || b.blockTime <= open.countdown_ends_at)));
  const refund = async (why: string) => {
    await addTickets(null, b.wallet, 1, 'pick', signature, whole(b.burned, b.decimals), cfg.max_tickets_per_wallet);
    return { ok: false, refunded: true, reason: why };
  };
  if (!selling) return refund('Guesses were closed for that round: you got 1 ticket credit instead.');
  const stakeTickets = price / cfg.ticket_price_tokens;
  const payout = pickPayout(balloonOdds(cfg)[color], stakeTickets, cfg.pick_return ?? 0.9);
  const { error } = await db.from('predictions').insert({ round_id: roundId, wallet: b.wallet, color, burn_tx: signature, tokens: whole(b.burned, b.decimals), tickets_if_win: payout });
  if (error) return refund('You already made a guess this round: you got 1 ticket credit instead.');
  return { ok: true, color, ticketsIfWin: payout };
}

/**
 * Called when a new round starts: guesses made during the previous round are settled against the
 * new balloon. If the balloon was forced (first rounds or the daily gold guarantee) nobody could
 * really guess, so every stake comes back as one ticket.
 */
export async function settlePredictions(prevRoundId: number, newRoundId: number, balloon: BalloonKey, forced: boolean, cfg: Config) {
  const { data, error } = await db.from('predictions').select('*').eq('round_id', prevRoundId).eq('status', 'open');
  if (error) throw error;
  for (const p of data ?? []) {
    const win = !forced && p.color === balloon;
    const tickets = forced ? 1 : win ? p.tickets_if_win : 0;
    if (tickets > 0) await addTickets(newRoundId, p.wallet, tickets, 'pick', `${p.burn_tx}:settle`, '0', cfg.max_tickets_per_wallet);
    await db.from('predictions').update({ status: forced ? 'refunded' : win ? 'won' : 'lost', settled_round: newRoundId }).eq('id', p.id);
  }
  return (data ?? []).length;
}

/** Once a week: the team that burned more wins bonus tickets for every member who burned that week. */
export async function settleTeamWeek(cfg: Config, now = Date.now()) {
  const thisWeek = weekStart(now), lastWeek = thisWeek - 7 * 86_400_000;
  const day = new Date(lastWeek).toISOString().slice(0, 10);
  const { data: done } = await db.from('team_weeks').select('week_start').eq('week_start', day).maybeSingle();
  if (done) return null;
  const from = new Date(lastWeek).toISOString(), to = new Date(thisWeek).toISOString();
  const { data: scores, error } = await db.rpc('team_scores', { p_from: from, p_to: to });
  if (error) throw error;
  const clowns = Number(scores?.find((s: any) => s.team === 'clowns')?.tokens ?? 0), acrobats = Number(scores?.find((s: any) => s.team === 'acrobats')?.tokens ?? 0);
  const winner = teamWinner(clowns, acrobats);
  let rewarded = 0;
  if (winner && (cfg.team_reward_tickets ?? 0) > 0) {
    const { data: burns } = await db.rpc('burns_by_wallet', { p_from: from, p_to: to });
    const { data: members } = await db.from('profiles').select('wallet').eq('team', winner);
    const active = new Set((burns ?? []).filter((x: any) => Number(x.tokens) > 0).map((x: any) => x.wallet));
    for (const mbr of members ?? []) {
      if (!active.has(mbr.wallet)) continue;
      await addTickets(null, mbr.wallet, cfg.team_reward_tickets!, 'team', null, '0', cfg.max_tickets_per_wallet);   // credits for the next rounds
      rewarded++;
    }
  }
  await db.from('team_weeks').insert({ week_start: day, clowns: clowns.toFixed(0), acrobats: acrobats.toFixed(0), winner, rewarded });
  return { winner, clowns, acrobats, rewarded };
}

/** Live score of the current week, for the snapshot. */
export async function teamWeekLive(now = Date.now()) {
  const from = new Date(weekStart(now)).toISOString(), to = new Date(weekStart(now) + 7 * 86_400_000).toISOString();
  const { data } = await db.rpc('team_scores', { p_from: from, p_to: to });
  const { data: last } = await db.from('team_weeks').select('*').order('week_start', { ascending: false }).limit(1).maybeSingle();
  const get = (t: string) => data?.find((s: any) => s.team === t);
  return {
    week_start: from, ends_at: to,
    clowns: Number(get('clowns')?.tokens ?? 0), acrobats: Number(get('acrobats')?.tokens ?? 0),
    clowns_members: get('clowns')?.members ?? 0, acrobats_members: get('acrobats')?.members ?? 0,
    last_winner: last?.winner ?? null,
  };
}
export const PICK_COLORS = COLORS;
