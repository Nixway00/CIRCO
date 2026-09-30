// Run on YOUR computer, never on a shared machine:  node scripts/new-wallets.mjs
// Creates the prize, buyback and team wallets and prints their addresses and secret keys.
// Put the secrets only in the engine's .env on the server. Back them up offline.
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
for (const name of ['PRIZE', 'BUYBACK', 'TEAM']) {
  const kp = Keypair.generate();
  console.log(`${name}_WALLET_ADDRESS=${kp.publicKey.toBase58()}`);
  console.log(`${name}_WALLET_SECRET=${bs58.encode(kp.secretKey)}\n`);
}
