import { db } from './db.ts';
import { teamWeekLive } from './show.ts';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { connection } from './chain.ts';
import { env } from './env.ts';

let reserveAt = 0, reserveSol = 0;
const buybackAddress = env.BUYBACK_WALLET_SECRET ? Keypair.fromSecretKey(bs58.decode(env.BUYBACK_WALLET_SECRET)).publicKey : null;

/**
 * Viewers never aggregate the whole database: the engine writes three small public rows
 * (stats, leaderboard, history) a few times a minute and the site subscribes to them.
 */
export async function refreshSnapshots() {
  const [{ data: stats }, { data: board }, { data: history }] = await Promise.all([
    db.from('public_stats').select('*').single(),
    db.from('leaderboard').select('*').order('sol_won', { ascending: false }).order('tickets_bought', { ascending: false }).limit(50),
    db.from('round_summary').select('*').order('id', { ascending: false }).limit(30),
  ]);
  const now = new Date().toISOString();
  const teams = await teamWeekLive().catch(() => null);
  // SOL already collected for the next balloons: overflow above full balloons, and fees that arrived
  // while a countdown or draw was running
  const [{ data: over }, { data: waiting }] = await Promise.all([
    db.from('rounds').select('overflow_sol').eq('overflow_pending', true),
    db.from('fees').select('amount_sol,jackpot_sol').is('round_id', null).eq('wallet', 'prize'),
  ]);
  // SOL the buyback is holding for the next dip (public, so everyone sees the buy wall waiting)
  // read once a minute (the snapshot itself refreshes every 15 s): RPC credits matter on a free plan
  if (buybackAddress && Date.now() - reserveAt > 60_000) { reserveAt = Date.now(); reserveSol = Math.max(0, (await connection.getBalance(buybackAddress).catch(() => 0)) / LAMPORTS_PER_SOL - 0.02); }
  const buyback_reserve_sol = reserveSol;
  const queue_sol = (over ?? []).reduce((a, r) => a + Number(r.overflow_sol), 0) + (waiting ?? []).reduce((a, f) => a + Number(f.amount_sol) - Number(f.jackpot_sol ?? 0), 0);
  const { error } = await db.from('snapshots').upsert([
    { key: 'stats', data: { ...(stats ?? {}), queue_sol, buyback_reserve_sol }, updated_at: now },
    { key: 'leaderboard', data: board ?? [], updated_at: now },
    { key: 'history', data: history ?? [], updated_at: now },
    { key: 'teams', data: teams ?? {}, updated_at: now },
  ], { onConflict: 'key' });
  if (error) throw error;
}

// ---------- the public stats page: heavier numbers, refreshed every minute ----------
import { MINT, prizeKeypair } from './chain.ts';
export async function refreshStatsPage() {
  const now = new Date().toISOString();
  const [{ data: daily }, { data: breakdown }, { data: buys }, { data: big }, supply] = await Promise.all([
    db.rpc('stats_daily', { p_days: 14 }),
    db.rpc('burn_breakdown'),
    db.from('buybacks').select('created_at,reason,sol_spent,tokens_burned,swap_tx,burn_tx').order('id', { ascending: false }).limit(20),
    db.from('rounds').select('id,prize_sol,jackpot_won,winner_wallet,mega,ended_at').eq('phase', 'done').order('prize_sol', { ascending: false }).limit(5),
    connection.getTokenSupply(MINT).then(x => Number(x.value.uiAmount ?? 0)).catch(() => null),
  ]);
  const bal = async (pk: any) => pk ? (await connection.getBalance(pk).catch(() => 0)) / LAMPORTS_PER_SOL : null;
  const team = env.TEAM_WALLET || null;
  const data = {
    supply_now: supply, supply_start: 1_000_000_000,
    daily: daily ?? [], breakdown: breakdown ?? [], buybacks: buys ?? [], biggest: big ?? [],
    wallets: {
      prize: { address: prizeKeypair.publicKey.toBase58(), sol: await bal(prizeKeypair.publicKey) },
      buyback: buybackAddress ? { address: buybackAddress.toBase58(), sol: await bal(buybackAddress) } : null,
      team: team ? { address: team, sol: await bal(new (await import('@solana/web3.js')).PublicKey(team)) } : null,
    },
  };
  await db.from('snapshots').upsert({ key: 'stats_page', data, updated_at: now }, { onConflict: 'key' });
}
