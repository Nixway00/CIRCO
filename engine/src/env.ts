function need(k: string): string { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; }
export const env = {
  SUPABASE_URL: need('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: need('SUPABASE_SERVICE_ROLE_KEY'),
  RPC_URL: need('RPC_URL'),
  CIRCO_MINT: need('CIRCO_MINT'),
  PRIZE_WALLET_SECRET: need('PRIZE_WALLET_SECRET'),
  HELIUS_WEBHOOK_SECRET: need('HELIUS_WEBHOOK_SECRET'),
  ENGINE_API_SECRET: need('ENGINE_API_SECRET'),
  PRIZE_WALLET_ADDRESS: process.env.PRIZE_WALLET_ADDRESS ?? '',
  BUYBACK_WALLET_SECRET: process.env.BUYBACK_WALLET_SECRET ?? '',
  PORT: Number(process.env.PORT ?? 8787),
  X_CLIENT_ID: process.env.X_CLIENT_ID ?? '',
  X_CLIENT_SECRET: process.env.X_CLIENT_SECRET ?? '',
  X_REFRESH_TOKEN: process.env.X_REFRESH_TOKEN ?? '',
  PUMPFUN_CHAT_TOKEN: process.env.PUMPFUN_CHAT_TOKEN ?? '',   // optional: a pump.fun session token (manual alternative)
  RINGMASTER_WALLET_SECRET: process.env.RINGMASTER_WALLET_SECRET ?? '',   // optional: the launch wallet, so the Ringmaster speaks on pump.fun with the creator badge
};
