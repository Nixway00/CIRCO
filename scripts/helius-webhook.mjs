// Creates the Helius webhook that feeds the engine.
// HELIUS_API_KEY=... ENGINE_URL=https://engine.yoursite.com HELIUS_WEBHOOK_SECRET=... \
// PRIZE_WALLET_ADDRESS=... CIRCO_MINT=... node scripts/helius-webhook.mjs
const { HELIUS_API_KEY, ENGINE_URL, HELIUS_WEBHOOK_SECRET, PRIZE_WALLET_ADDRESS, CIRCO_MINT } = process.env;
if (!HELIUS_API_KEY || !ENGINE_URL || !HELIUS_WEBHOOK_SECRET || !PRIZE_WALLET_ADDRESS || !CIRCO_MINT) {
  console.error('Missing env: HELIUS_API_KEY, ENGINE_URL, HELIUS_WEBHOOK_SECRET, PRIZE_WALLET_ADDRESS, CIRCO_MINT'); process.exit(1);
}
const res = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${HELIUS_API_KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    webhookURL: `${ENGINE_URL}/helius`,
    webhookType: 'enhanced',
    transactionTypes: ['ANY'],
    accountAddresses: [PRIZE_WALLET_ADDRESS, CIRCO_MINT],   // fees landing on the prize wallet + trades of the coin
    authHeader: HELIUS_WEBHOOK_SECRET,
  }),
});
console.log(res.status, await res.text());
