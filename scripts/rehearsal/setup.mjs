import { createRequire } from 'node:module';
const require = createRequire('/tmp/gitrepo/engine/package.json');
const { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { createMint, getOrCreateAssociatedTokenAccount, mintTo } = require('@solana/spl-token');
const bs58 = require('bs58').default || require('bs58');
const fs = require('fs');
const c = new Connection('http://127.0.0.1:8899', 'confirmed');
const kp = () => Keypair.generate();
const W = { funder: kp(), prize: kp(), buyback: kp(), team: kp(), mintAuth: kp(), pumpfees: kp(), bots: Array.from({ length: 6 }, kp) };
const air = async (k, sol) => { const s = await c.requestAirdrop(k.publicKey, sol * LAMPORTS_PER_SOL); await c.confirmTransaction(s, 'confirmed'); };
await air(W.funder, 500); await air(W.mintAuth, 10); await air(W.pumpfees, 200); await air(W.team, 5);
for (const b of W.bots) await air(b, 2);
await air(W.buyback, 1);
// the reserve: the team tops up the prize wallet (must NOT count as a fee)
await sendAndConfirmTransaction(c, new Transaction().add(SystemProgram.transfer({ fromPubkey: W.team.publicKey, toPubkey: W.prize.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL })), [W.team]);
const mint = await createMint(c, W.mintAuth, W.mintAuth.publicKey, null, 6);
for (const b of W.bots) { const ata = await getOrCreateAssociatedTokenAccount(c, W.funder, mint, b.publicKey); await mintTo(c, W.funder, mint, ata.address, W.mintAuth, 5_000_000n * 1_000_000n); }
const out = { mint: mint.toBase58() };
for (const [k, v] of Object.entries(W)) out[k] = Array.isArray(v) ? v.map(x => bs58.encode(x.secretKey)) : bs58.encode(v.secretKey);
fs.writeFileSync('/tmp/devnet/state.json', JSON.stringify(out, null, 1));
console.log('mint', out.mint, '| prize', W.prize.publicKey.toBase58(), '| prize balance', (await c.getBalance(W.prize.publicKey)) / LAMPORTS_PER_SOL);
