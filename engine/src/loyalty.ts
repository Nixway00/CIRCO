// Loyalty tickets and milestone balloons.
import { PublicKey } from '@solana/web3.js';
import { db, addTickets } from './db.ts';
import { connection, MINT } from './chain.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const today = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

async function balanceOf(owner: string): Promise<number> {
  const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: MINT });
  return res.value.reduce((a, acc) => a + Number((acc.account.data as any).parsed.info.tokenAmount.uiAmount ?? 0), 0);
}

/**
 * Once a day, for every registered player: if the wallet held at least the minimum yesterday and still
 * does today, it gets its loyalty tickets (credits for the next rounds). Holding is playing.
 * Only wallets with a nickname are checked, one every 150 ms to stay under the RPC rate limit.
 */
export async function runLoyalty(cfg: any) {
  const min = Number(cfg.loyalty_min_tokens ?? 0), give = Number(cfg.loyalty_tickets ?? 0);
  if (!min || !give) return null;
  const day = today(), yesterday = today(Date.now() - 86_400_000);
  const { data: done } = await db.from('loyalty_balances').select('wallet').eq('day', day).limit(1);
  if (done?.length) return null;                                     // already ran today
  const { data: players } = await db.from('profiles').select('wallet');
  const { data: prev } = await db.from('loyalty_balances').select('wallet,tokens').eq('day', yesterday);
  const held = new Map((prev ?? []).map(p => [p.wallet, Number(p.tokens)]));
  let rewarded = 0;
  for (const p of players ?? []) {
    let tokens = 0;
    try { tokens = await balanceOf(p.wallet); } catch { continue; }
    await db.from('loyalty_balances').upsert({ wallet: p.wallet, day, tokens: Math.floor(tokens).toString() }, { onConflict: 'wallet,day' });
    if (tokens >= min && (held.get(p.wallet) ?? 0) >= min) { await addTickets(null, p.wallet, give, 'loyalty', null, '0', cfg.max_tickets_per_wallet); rewarded++; }
    await sleep(150);
  }
  await db.from('loyalty_balances').delete().lt('day', today(Date.now() - 7 * 86_400_000));
  return { checked: players?.length ?? 0, rewarded };
}

// ---------- market cap and milestones ----------
let solUsd = 0, solUsdAt = 0, supply = 0, supplyAt = 0;

/** USD value of one whole $CIRCO, from the latest price sample and the SOL price. */
export async function tokenUsd(): Promise<number | null> {
  const { data: tick } = await db.from('price_ticks').select('price').order('ts', { ascending: false }).limit(1).maybeSingle();
  if (!tick) return null;
  if (Date.now() - solUsdAt > 10 * 60_000) {
    const q = await (await fetch('https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000&slippageBps=50')).json();
    if (q?.outAmount) { solUsd = Number(q.outAmount) / 1e6; solUsdAt = Date.now(); }
  }
  return solUsd ? Number(tick.price) * solUsd : null;
}

/** Market cap in USD from the latest price sample (SOL per token), the live supply and the SOL price. */
export async function marketCapUsd(): Promise<number | null> {
  const { data: tick } = await db.from('price_ticks').select('price').order('ts', { ascending: false }).limit(1).maybeSingle();
  if (!tick) return null;
  if (Date.now() - solUsdAt > 10 * 60_000) {
    const q = await (await fetch('https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000&slippageBps=50')).json();
    if (q?.outAmount) { solUsd = Number(q.outAmount) / 1e6; solUsdAt = Date.now(); }
  }
  if (Date.now() - supplyAt > 30 * 60_000) { supply = Number((await connection.getTokenSupply(MINT)).value.uiAmount ?? 0); supplyAt = Date.now(); }
  if (!solUsd || !supply) return null;
  return Number(tick.price) * supply * solUsd;
}

/** When the market cap crosses a new milestone, the next balloon becomes a Milestone gold trophy. */
export async function checkMilestones(cfg: any, announce: (usd: number) => Promise<void>) {
  const mcap = await marketCapUsd();
  if (mcap === null) return null;
  const list: number[] = Array.isArray(cfg.milestones_usd) ? cfg.milestones_usd : [];
  const reached: number[] = Array.isArray(cfg.milestones_reached) ? cfg.milestones_reached : [];
  const crossed = list.filter(m => mcap >= m && !reached.includes(m));
  if (crossed.length) {
    const top = Math.max(...crossed);
    const now = new Date().toISOString();
    await db.from('config').update({ value: [...reached, ...crossed] as any, updated_at: now }).eq('key', 'milestones_reached');
    await db.from('config').update({ value: top as any, updated_at: now }).eq('key', 'milestone_pending');
    cfg.milestones_reached = [...reached, ...crossed]; cfg.milestone_pending = top;
    await announce(top);
  }
  const next = list.filter(m => !(cfg.milestones_reached ?? []).includes(m)).sort((a, b) => a - b)[0] ?? null;
  return { mcap, next };
}

/**
 * Keeps the ticket near its dollar target. When the right number of tokens moves more than 20% away
 * from the current price, the new price is announced and applied from the next round.
 */
export async function adjustTicketPrice(cfg: any, announce: (tokens: number, usd: number) => Promise<void>) {
  if (cfg.ticket_price_mode !== 'usd') return null;
  const usd = await tokenUsd();
  if (!usd) return null;
  const { ticketTokensForUsd } = await import('./rules.ts');
  const target = Number(cfg.ticket_usd_target ?? 0.25);
  const tokens = ticketTokensForUsd(target, usd, Number(cfg.ticket_tokens_min ?? 1000), Number(cfg.ticket_tokens_max ?? 1_000_000));
  const current = Number(cfg.ticket_price_tokens), pending = Number(cfg.ticket_price_pending ?? 0);
  if (pending === tokens || Math.abs(tokens - current) / current < 0.2) return null;
  await db.from('config').update({ value: tokens as any, updated_at: new Date().toISOString() }).eq('key', 'ticket_price_pending');
  cfg.ticket_price_pending = tokens;
  await announce(tokens, tokens * usd);
  return { tokens, usd: tokens * usd };
}

/** At the start of a round: a pending ticket price becomes the price (games and guesses cost one ticket too). */
export async function applyPendingTicketPrice(cfg: any) {
  const p = Number(cfg.ticket_price_pending ?? 0);
  if (!p || p === Number(cfg.ticket_price_tokens)) return null;
  const now = new Date().toISOString(), prev = Number(cfg.ticket_price_tokens);
  const set = (key: string, value: any) => db.from('config').update({ value, updated_at: now }).eq('key', key);
  await Promise.all([
    set('ticket_price_prev', prev), set('ticket_price_changed_at', Date.now()), set('ticket_price_tokens', p),
    set('game_price_tokens', p), set('pick_price_tokens', p), set('ticket_price_pending', 0),
  ]);
  Object.assign(cfg, { ticket_price_prev: prev, ticket_price_changed_at: Date.now(), ticket_price_tokens: p, game_price_tokens: p, pick_price_tokens: p, ticket_price_pending: 0 });
  return { from: prev, to: p };
}
