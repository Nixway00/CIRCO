import { randomBytes } from 'node:crypto';
import { db, openRound, addTickets } from './db.ts';
import { readBurn } from './chain.ts';
import { commit, gameOutcome, gameTicketsAllowed, type Config } from './rules.ts';

export interface GameConfig { game_price_tokens: number; game_shots: number; game_hit_chance: number; game_daily_ticket_cap: number }

const dayStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString(); };

/** Tickets a wallet already won in games today (UTC), paid or credited. */
export async function wonToday(wallet: string): Promise<number> {
  const { data, error } = await db.from('games').select('tickets_given,credited').eq('wallet', wallet).eq('status', 'played').gte('played_at', dayStart());
  if (error) throw error;
  return (data ?? []).reduce((a, g) => a + (g.tickets_given ?? 0) + (g.credited ?? 0), 0);
}

/** Step 1: commit to a secret before the player burns anything. */
export async function startGame(wallet: string, cfg: Config & GameConfig) {
  // anti-spam: starting a game costs nothing, so unpaid games are capped per wallet and overall
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const [{ count: mine }, { count: all }] = await Promise.all([
    db.from('games').select('id', { count: 'exact', head: true }).eq('wallet', wallet).eq('status', 'waiting').gte('created_at', since),
    db.from('games').select('id', { count: 'exact', head: true }).eq('status', 'waiting').gte('created_at', since),
  ]);
  if ((mine ?? 0) >= 3) throw new Error('Finish or wait for your last games before starting a new one.');
  if ((all ?? 0) >= 500) throw new Error('The gallery is busy, try again in a minute.');
  const won = await wonToday(wallet);
  if (won >= cfg.game_daily_ticket_cap) throw new Error(`You already won ${won} tickets in games today. Come back tomorrow.`);
  const secret = randomBytes(32).toString('hex');
  const { data: game, error } = await db.from('games').insert({ wallet, seed_commit: commit(secret) }).select('id,seed_commit').single();
  if (error) throw error;
  const { error: e2 } = await db.from('game_secrets').insert({ game_id: game.id, secret });
  if (e2) throw e2;
  return { id: game.id, commit: game.seed_commit, price: cfg.game_price_tokens, shots: cfg.game_shots, chance: cfg.game_hit_chance, remainingToday: cfg.game_daily_ticket_cap - won };
}

/**
 * Step 2: the burn (memo "CIRCO-GAME:<id>", exactly the game price, signed by the game's wallet)
 * decides the shots together with the committed secret. Idempotent: replaying returns the same result.
 */
export async function playGame(id: string, signature: string, cfg: Config & GameConfig) {
  const { data: game, error } = await db.from('games').select('*').eq('id', id).single();
  if (error || !game) throw new Error('game not found');
  if (game.status === 'played') return publicResult(game);

  const b = await readBurn(signature);
  if (b.memo !== `CIRCO-GAME:${id}`) throw new Error('memo does not match this game');
  if (b.wallet !== game.wallet) throw new Error('burn signed by another wallet');
  const expected = BigInt(cfg.game_price_tokens) * 10n ** BigInt(b.decimals);
  if (b.burned !== expected) throw new Error(`burned ${b.burned}, expected ${expected}`);

  const { data: sec, error: e2 } = await db.from('game_secrets').select('secret').eq('game_id', id).single();
  if (e2 || !sec) throw new Error('game secret missing');
  const outcomes = gameOutcome(sec.secret, signature, cfg.game_shots, cfg.game_hit_chance);
  const hits = outcomes.filter(Boolean).length;
  const allowed = gameTicketsAllowed(hits, await wonToday(game.wallet), cfg.game_daily_ticket_cap);
  const open = await openRound();
  const selling = !!open && (open.phase === 'inflate' || (open.phase === 'countdown' && (!open.countdown_ends_at || Date.now() <= open.countdown_ends_at)));
  const added = allowed > 0
    ? await addTickets(selling ? open!.id : null, game.wallet, allowed, 'game', signature, (b.burned / 10n ** BigInt(b.decimals)).toString(), cfg.max_tickets_per_wallet)
    : { given: 0, credited: 0, duplicate: false };

  const { data: done, error: e3 } = await db.from('games').update({
    status: 'played', burn_tx: signature, tokens_burned: (b.burned / 10n ** BigInt(b.decimals)).toString(), seed_secret: sec.secret,
    shots: cfg.game_shots, outcomes, hits, tickets_given: added.given, credited: added.credited, capped: hits - allowed,
    round_id: selling ? open!.id : null, played_at: new Date().toISOString(),
  }).eq('id', id).eq('status', 'waiting').select('*').single();
  if (e3 || !done) {   // someone else finished it first: return what is stored
    const { data: again } = await db.from('games').select('*').eq('id', id).single();
    return publicResult(again);
  }
  return publicResult(done);
}

function publicResult(g: any) {
  return { id: g.id, outcomes: g.outcomes, hits: g.hits, given: g.tickets_given, credited: g.credited, capped: g.capped, commit: g.seed_commit, secret: g.seed_secret, burn_tx: g.burn_tx };
}

/** Webhook path: a game burn is settled even if the player closed the page right after burning. */
export async function settleGameFromBurn(signature: string, cfg: Config & GameConfig) {
  const b = await readBurn(signature);
  const m = b.memo?.match(/^CIRCO-GAME:([0-9a-f-]{36})$/);
  if (m) await playGame(m[1], signature, cfg);
}

/** Games started but never paid are removed after an hour (their secret was never used). */
export async function cleanupGames() {
  const old = new Date(Date.now() - 3600_000).toISOString();
  const { data } = await db.from('games').select('id').eq('status', 'waiting').lt('created_at', old).limit(500);
  const ids = (data ?? []).map(g => g.id);
  if (!ids.length) return 0;
  await db.from('game_secrets').delete().in('game_id', ids);
  await db.from('games').delete().in('id', ids).eq('status', 'waiting');
  return ids.length;
}
