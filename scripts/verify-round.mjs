#!/usr/bin/env node
// Recompute a $CIRCO round from public data only: commit, winner, Mega Pop, next balloon.
// Usage: node scripts/verify-round.mjs <round>        (Node 18+, no dependencies)
import { createHash } from 'node:crypto';

const URL = process.env.CIRCO_SUPABASE_URL ?? 'https://rgpzaqcnenpjpkzguqql.supabase.co';
const KEY = process.env.CIRCO_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJncHphcWNuZW5wanBremd1cXFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3MzU1NzcsImV4cCI6MjEwNjMxMTU3N30.8UKsijVOBPy9sBPp-WFxSlQ8kBpuhRVgH8Yj3-Benpo'; // public read-only key
const id = Number(process.argv[2]);
if (!id) { console.error('usage: node scripts/verify-round.mjs <round>'); process.exit(1); }

const get = async (q) => { const r = await fetch(`${URL}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }); if (!r.ok) throw new Error(`${r.status} ${await r.text()}`); return r.json(); };
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const u32 = (s) => createHash('sha256').update(s).digest().readUInt32BE(0) / 0x1_0000_0000;
const ok = (b) => (b ? '✓' : '✗');

const [r] = await get(`rounds?id=eq.${id}&select=*`);
if (!r) { console.error(`round ${id} not found`); process.exit(1); }
if (!r.seed_secret) { console.error(`round ${id} is not finished yet (phase: ${r.phase})`); process.exit(1); }
const tickets = await get(`tickets?round_id=eq.${id}&select=wallet,count`);
const cfg = Object.fromEntries((await get('config?select=key,value&key=in.(jackpot_chance,balloons)')).map(c => [c.key, c.value]));

console.log(`Round ${id} · ${r.balloon} balloon · ${r.phase}\n`);
const commitOk = sha256(r.seed_secret) === r.seed_commit;
console.log(`commit       sha256(secret) = ${sha256(r.seed_secret)}\n             published      = ${r.seed_commit}  ${ok(commitOk)}`);
const seed = sha256(`${r.seed_secret}:${r.close_blockhash}:${id}`);

// the seeding block must be the FIRST block at least 2 seconds after sales closed (the engine cannot pick it)
const RPC = process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';
const rpc = async (method, params) => (await (await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
try {
  const target = Math.ceil(Date.parse(r.countdown_ends_at) / 1000) + 2;
  const t = await rpc('getBlockTime', [r.close_slot]);
  const before = await rpc('getBlocks', [Math.max(0, r.close_slot - 60), r.close_slot - 1]);
  const prev = before?.length ? before[before.length - 1] : null;
  const tp = prev !== null ? await rpc('getBlockTime', [prev]) : null;
  const ruleOk = t !== null && t >= target && (tp === null || tp < target);
  console.log(`close block  sales closed ${r.countdown_ends_at}; slot ${r.close_slot} at ${new Date(t * 1000).toISOString()}, previous block ${prev} at ${tp ? new Date(tp * 1000).toISOString() : '-'}  ${ok(ruleOk)} first block ≥ close + 2 s`);
} catch { console.log('close block  (skipped: set SOLANA_RPC to an RPC that serves old blocks to check it)'); }
console.log(`blockhash    ${r.close_blockhash} (slot ${r.close_slot})\nseed         ${seed}`);

if (r.phase === 'done') {
  const per = new Map(); for (const t of tickets) per.set(t.wallet, (per.get(t.wallet) ?? 0) + t.count);
  const sorted = [...per].filter(([, n]) => n > 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const total = sorted.reduce((a, [, n]) => a + n, 0);
  const idx = Number(BigInt('0x' + seed) % BigInt(total));
  let acc = 0, winner = null; for (const [w, n] of sorted) { acc += n; if (idx < acc) { winner = w; break; } }
  console.log(`\ntickets      ${total} in play, ${sorted.length} wallets (sorted by address)`);
  console.log(`winner       ticket #${idx} → ${winner}  ${ok(winner === r.winner_wallet)} (recorded: ${r.winner_wallet})`);
  const mega = u32(`${seed}:mega`);
  console.log(`mega pop     sha256(seed:mega) = ${mega.toFixed(6)} vs chance ${cfg.jackpot_chance} → ${r.mega ? `Mega Pop, ${r.jackpot_won} SOL jackpot` : 'no Mega Pop'}`);
}
const weights = cfg.balloons ?? {};
const order = ['green', 'blue', 'red', 'gold'].filter(k => k in weights);
const tot = order.reduce((a, k) => a + Number(weights[k].weight), 0);
let x = u32(`${seed}:balloon`) * tot, next = 'blue';
for (const k of order) { x -= Number(weights[k].weight); if (x <= 0) { next = k; break; } }
const [n] = await get(`rounds?id=gt.${id}&select=id,balloon&order=id.asc&limit=1`);
console.log(`next balloon sha256(seed:balloon) → ${next}${n ? `  (round ${n.id} was ${n.balloon}${n.balloon === next ? ' ✓' : ': fixed by the first rounds or the gold guarantee'})` : ''}`);
console.log(`\n${commitOk ? 'Commit verified.' : 'COMMIT MISMATCH.'}`);
