import { createRequire } from 'node:module';
const require = createRequire('/tmp/gitrepo/engine/package.json');
const { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, TransactionInstruction, PublicKey, sendAndConfirmTransaction } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, createBurnCheckedInstruction } = require('@solana/spl-token');
const bs58 = require('bs58').default || require('bs58');
const fs = require('fs');
const S = JSON.parse(fs.readFileSync('/tmp/devnet/state.json'));
const c = new Connection('http://127.0.0.1:8899', 'confirmed');
const K = s => Keypair.fromSecretKey(bs58.decode(s));
const bots = S.bots.map(K), prize = K(S.prize), pumpfees = K(S.pumpfees), MINT = new PublicKey(S.mint);
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const JWT = fs.readFileSync('/tmp/devnet/service.jwt', 'utf8').trim();
const rest = async (q) => (await fetch('http://127.0.0.1:54321/rest/v1/' + q, { headers: { Authorization: 'Bearer ' + JWT } })).json();
const engine = async (path, body) => { const r = await fetch('http://127.0.0.1:8787' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-engine-secret': 'test-secret' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
export async function openRound() { return (await rest('rounds?select=*&phase=in.(inflate,countdown,drawing)&order=id.desc&limit=1'))[0]; }
export async function fee(sol) { return sendAndConfirmTransaction(c, new Transaction().add(SystemProgram.transfer({ fromPubkey: pumpfees.publicKey, toPubkey: prize.publicKey, lamports: Math.round(sol * LAMPORTS_PER_SOL) })), [pumpfees]); }
export async function burn(i, tokens, memo) {
  const b = bots[i], ata = getAssociatedTokenAddressSync(MINT, b.publicKey);
  const tx = new Transaction().add(createBurnCheckedInstruction(ata, MINT, b.publicKey, BigInt(tokens) * 1_000_000n, 6)).add(new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(memo) }));
  return sendAndConfirmTransaction(c, tx, [b]);
}
export async function buy(i, n, { confirm = true, round } = {}) {
  const r = round ?? (await openRound())?.id;
  const sig = await burn(i, n * 10000, `CIRCO:${r}:${n}`);
  return confirm ? { sig, ...(await engine('/tickets/confirm', { signature: sig })) } : { sig };
}
export async function game(i) {
  const g = await engine('/games/start', { wallet: bots[i].publicKey.toBase58() });
  if (g.status !== 200) return g;
  const sig = await burn(i, 10000, `CIRCO-GAME:${g.body.id}`);
  return engine('/games/play', { id: g.body.id, signature: sig });
}
export async function fx(i, effect, tokens) { const sig = await burn(i, tokens, `CIRCO-FX:${effect}`); return engine('/fx/confirm', { signature: sig }); }
export async function pick(i, color, round) { const r = round ?? (await openRound())?.id; const sig = await burn(i, 10000, `CIRCO-PICK:${r}:${color}`); return engine('/picks/confirm', { signature: sig }); }
export const addr = i => bots[i].publicKey.toBase58();
export const sol = async (pk) => (await c.getBalance(typeof pk === 'string' ? new PublicKey(pk) : pk)) / LAMPORTS_PER_SOL;
export const prizeAddr = prize.publicKey.toBase58();
export { rest, engine, c, bots };
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function waitPhase(phases, timeoutMs = 90000) {
  const t0 = Date.now();
  for (;;) { const r = (await rest('rounds?select=*&order=id.desc&limit=1'))[0]; if (phases.includes(r?.phase)) return r; if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting ' + phases + ' (now ' + r?.phase + ')'); await sleep(1000); }
}
