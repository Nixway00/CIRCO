import { Keypair, LAMPORTS_PER_SOL, Transaction, VersionedTransaction } from '@solana/web3.js';
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import { connection, MINT, mintDecimals, mintProgram } from './chain.ts';
import { env } from './env.ts';
import { db } from './db.ts';
import { decideBuyback, splitChunks, initialState, type BuybackCfg, type BuybackState } from './buybackStrategy.ts';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUP = 'https://lite-api.jup.ag/swap/v1';
const RESERVE_SOL = 0.02;        // kept in the wallet for network fees
const PROBE_LAMPORTS = 10_000_000; // 0.01 SOL: a tiny quote that reads the price without trading
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let nextAllowedAt = 0;           // random cool-down between buybacks, so there is no clock to front-run
let state: BuybackState | null = null;   // dip episode, pacing clocks: kept in engine_state so restarts do not repeat a tranche

async function loadState(): Promise<BuybackState> {
  if (state) return state;
  const { data } = await db.from('engine_state').select('value').eq('key', 'buyback').maybeSingle();
  state = (data?.value as BuybackState) ?? initialState();
  return state;
}
async function saveState(s: BuybackState) {
  state = s;
  await db.from('engine_state').upsert({ key: 'buyback', value: s, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

export interface BuybackSettings extends BuybackCfg { maxImpact: number; enabled: boolean }
export function buybackSettings(cfg: any): BuybackSettings {
  return {
    enabled: cfg.buyback_mode !== 'off',
    dipPct: Number(cfg.buyback_dip_pct ?? 0.12),
    quietVolumeSol: Number(cfg.buyback_quiet_volume_sol ?? 5),
    maxHoldSol: Number(cfg.buyback_max_hold_sol ?? 10),
    maxHoldHours: Number(cfg.buyback_max_hold_hours ?? 24),
    maxImpact: Number(cfg.buyback_max_impact ?? 0.02),
    minBuySol: Number(cfg.buyback_min_buy_sol ?? 0.05),
  };
}

async function quote(lamports: number, slippageBps = 150) {
  const q = await (await fetch(`${JUP}/quote?inputMint=${SOL_MINT}&outputMint=${MINT.toBase58()}&amount=${lamports}&slippageBps=${slippageBps}`)).json();
  if (!q?.outAmount) throw new Error(`no Jupiter quote: ${JSON.stringify(q).slice(0, 160)}`);
  return q;
}

/** Every minute: record the price (SOL per whole token) so the strategy can see dips. */
export async function samplePrice(): Promise<void> {
  const q = await quote(PROBE_LAMPORTS);
  const dec = await mintDecimals();
  const tokens = Number(q.outAmount) / 10 ** dec;
  if (tokens > 0) await db.from('price_ticks').insert({ price: (PROBE_LAMPORTS / LAMPORTS_PER_SOL) / tokens });
  await db.from('price_ticks').delete().lt('ts', new Date(Date.now() - 24 * 3600_000).toISOString());
}

async function market(now: number) {
  const [{ data: ticks }, { data: trades }, { data: last }] = await Promise.all([
    db.from('price_ticks').select('ts,price').gte('ts', new Date(now - 6 * 60 * 60_000).toISOString()).order('ts', { ascending: true }).limit(400),
    db.from('trades').select('amount_sol').gte('created_at', new Date(now - 30 * 60_000).toISOString()),
    db.from('buybacks').select('created_at').order('id', { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    prices: (ticks ?? []).map(t => ({ t: Date.parse(t.ts), p: Number(t.price) })),
    volume30mSol: (trades ?? []).reduce((a, t) => a + Number(t.amount_sol), 0),
    lastBuyAt: last ? Date.parse(last.created_at) : null,
  };
}

/**
 * Runs every minute. Decides whether to buy (dip, deep dip, quiet support, drip) and executes the buy
 * in a few uneven chunks, each capped by price impact, then burns everything the wallet holds.
 * Returns what happened so the Ringmaster can announce the big ones.
 */
export async function runBuyback(cfg: any): Promise<{ reason: string; sol: number; burned: string; note: string } | null> {
  if (!env.BUYBACK_WALLET_SECRET) return null;
  const s = buybackSettings(cfg);
  if (!s.enabled || Date.now() < nextAllowedAt) return null;
  const kp = Keypair.fromSecretKey(bs58.decode(env.BUYBACK_WALLET_SECRET));
  // The buyback wallet may also be the creator's wallet, holding SOL of its own. The bot only spends
  // what fee sharing gave it: its 45% equals the prize wallet's 45%, so the budget is the fees counted
  // so far minus what the buybacks already spent. The creator's own SOL is never touched.
  const [{ data: feeRows }, { data: buyRows }] = await Promise.all([
    db.from('fees').select('amount_sol'),
    db.from('buybacks').select('sol_spent'),
  ]);
  const earned = (feeRows ?? []).reduce((a, f) => a + Number(f.amount_sol), 0);
  const spentSoFar = (buyRows ?? []).reduce((a, b) => a + Number(b.sol_spent), 0);
  const wallet = (await connection.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL - RESERVE_SOL;
  const available = Math.max(0, Math.min(wallet, earned - spentSoFar));
  const now = Date.now();
  const m = await market(now);
  const before = await loadState();
  const out = decideBuyback({ ...before, lastBuyAt: before.lastBuyAt ?? m.lastBuyAt }, available, { prices: m.prices, volume30mSol: m.volume30mSol, now }, s);
  if (JSON.stringify(out.state) !== JSON.stringify(before)) await saveState(out.state);
  const d = out.decision;
  if (d.reason === 'wait') return null;

  // the buyback wallet can be the launch (creator) wallet, which may hold its own tokens:
  // only what THIS buyback buys is burned, never the rest of the balance
  const tokensBefore = await tokenBalance(kp);
  let spent = 0;
  for (const chunk of splitChunks(d.spendSol, s.minBuySol)) {
    // shrink a chunk until its price impact is acceptable, or skip it
    let lamports = Math.floor(chunk * LAMPORTS_PER_SOL), q: any = null;
    while (lamports >= s.minBuySol * LAMPORTS_PER_SOL) {
      q = await quote(lamports);
      if (Number(q.priceImpactPct ?? 0) <= s.maxImpact) break;
      lamports = Math.floor(lamports / 2); q = null;
    }
    if (!q) continue;
    const swap = await (await fetch(`${JUP}/swap`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteResponse: q, userPublicKey: kp.publicKey.toBase58(), dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto' }),
    })).json();
    const vtx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
    vtx.sign([kp]);
    const sig = await connection.sendRawTransaction(vtx.serialize(), { maxRetries: 3 });
    await connection.confirmTransaction(sig, 'confirmed');
    await db.from('buybacks').insert({ swap_tx: sig, sol_spent: lamports / LAMPORTS_PER_SOL, tokens_burned: 0, reason: d.reason });
    spent += lamports / LAMPORTS_PER_SOL;
    await sleep(4000 + Math.random() * 12000);             // spread the chunks over some blocks
  }
  const burned = await burnBought(kp, d.reason, tokensBefore);
  nextAllowedAt = Date.now() + (3 + Math.random() * 5) * 60_000;   // 3 to 8 minutes before the next one
  return spent > 0 ? { reason: d.reason, sol: spent, burned, note: d.note } : null;
}

async function tokenBalance(kp: Keypair): Promise<bigint> {
  const prog = await mintProgram();
  try { return (await getAccount(connection, getAssociatedTokenAddressSync(MINT, kp.publicKey, false, prog), 'confirmed', prog)).amount; } catch { return 0n; }
}

/** Burns exactly the $CIRCO this buyback added to the wallet (balance now minus balance before buying). */
async function burnBought(kp: Keypair, reason: string, before: bigint): Promise<string> {
  const prog = await mintProgram();
  const ata = getAssociatedTokenAddressSync(MINT, kp.publicKey, false, prog);
  const now = await tokenBalance(kp);
  const amount = now > before ? now - before : 0n;
  if (amount === 0n) return '0';
  const dec = await mintDecimals();
  const burnSig = await connection.sendTransaction(new Transaction().add(createBurnCheckedInstruction(ata, MINT, kp.publicKey, amount, dec, [], prog)), [kp]);
  await connection.confirmTransaction(burnSig, 'confirmed');
  const whole = (amount / 10n ** BigInt(dec)).toString();
  await db.from('buybacks').insert({ burn_tx: burnSig, sol_spent: 0, tokens_burned: whole, reason });
  return whole;
}
