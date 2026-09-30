import * as B from './bot.mjs';
// count on-chain transfers from the prize wallet to each wallet since the start: a double payment would show up here
const sigs = await B.c.getSignaturesForAddress(new ((await import('node:module')).createRequire('/tmp/gitrepo/engine/package.json')('@solana/web3.js').PublicKey)(B.prizeAddr), { limit: 100 });
const out = {};
for (const s of sigs) { const tx = await B.c.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 }); if (!tx || tx.meta.err) continue;
  for (const ix of tx.transaction.message.instructions) if (ix.parsed?.type === 'transfer' && ix.parsed.info.source === B.prizeAddr) { const k = ix.parsed.info.destination.slice(0, 4) + ':' + ix.parsed.info.lamports; out[k] = (out[k] ?? 0) + 1; } }
console.log('on-chain payouts from the prize wallet (destination:lamports -> times):', JSON.stringify(out));
