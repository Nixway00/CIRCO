# Operations

How to run $CIRCO: setup, settings, deployment, costs.

## Setup

1. **Database.** Create a Supabase project and run every file in `supabase/migrations` in order.
2. **Wallets.** On your own computer: `cd scripts && npm install && node new-wallets.mjs`. It creates the prize, buyback and team wallets. Secrets stay offline and go only into the engine's secret settings. Put the team wallet in `team_wallets`.
3. **Helius.** Create an API key, then `node scripts/helius-webhook.mjs` with the variables listed at the top of the file.
4. **Engine.** `cd engine && cp .env.example .env`, fill it in, `npm install`, `npm test`, `npm start`. Run it on an always-on server with `pm2 start ecosystem.config.cjs` or the included `Dockerfile`.
5. **Site.** `cd web && cp .env.example .env.local`, fill it in, `npm install`, `npm run dev`. Deploy on Vercel. The team panel is at `/admin`.
6. **Prize reserve.** Send about 0.02 SOL from the team wallet to the prize wallet (it pays network fees; it is not counted as prize).
7. **Launch.** Create $CIRCO on pump.fun from the launch wallet; set creator fee sharing to 45% prize, 45% buyback, 10% team, and lock it.

## Engine settings

| Variable | Required | Meaning |
| --- | :---: | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | ✓ | Database access (write) |
| `RPC_URL` | ✓ | Solana RPC (Helius) |
| `CIRCO_MINT` | ✓ | The token's mint address |
| `PRIZE_WALLET_SECRET`, `PRIZE_WALLET_ADDRESS` | ✓ | Pays winners |
| `BUYBACK_WALLET_SECRET` | | Buyback and burn |
| `TEAM_WALLET` | | Its transfers to the prize wallet are not prize |
| `IGNORE_FEE_FROM` | | More wallets whose transfers are not prize (comma list) |
| `HELIUS_WEBHOOK_SECRET`, `ENGINE_API_SECRET` | ✓ | Shared secrets with Helius and the site |
| `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REFRESH_TOKEN` | | Automatic posts on X |
| `RINGMASTER_WALLET_SECRET` | | The launch wallet: the Ringmaster speaks in the pump.fun chat |
| `PORT` | | Default 8787 |

## Site settings

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public read access |
| `RPC_URL` | Solana RPC (server only: the browser reaches it through `/api/rpc`) |
| `RPC_FALLBACK_URL` | Optional: used when the main RPC is rate-limited (default: public Solana RPC) |
| `NEXT_PUBLIC_CIRCO_MINT` | The token's mint address |
| `NEXT_PUBLIC_PUMPFUN_URL`, `NEXT_PUBLIC_SITE_URL` | Links and share images |
| `SUPABASE_SERVICE_ROLE_KEY` | Nicknames, chat, team panel |
| `ENGINE_URL`, `ENGINE_API_SECRET` | Forwarding burns to the engine |
| `ADMIN_WALLETS` | Wallets allowed in the team panel (comma list) |
| `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI` | "Link X" in Profile |

## Game settings

Changed from the team panel at `/admin` (signed by an admin wallet, range-checked): ticket price, chat minimum, balloons, mission bonus, Mega Jackpot share and chance, guess price and return, shooting gallery price, shots, hit chance and daily cap, team reward, pump.fun chat bridge. The engine picks up changes within a minute. Announce price changes on X first.

## Running costs (estimate)

| Item | Cost per month |
| --- | --- |
| Helius RPC, Developer plan (webhooks, 50 requests/s) | $49 |
| Engine server (small VPS, always on) | €5–15 |
| Supabase | free at first, then Pro |
| Vercel | free at first, Pro for commercial use |
| X API, one post per pop | about $0.015 per post without a link |
| Domain | about €15 per year |

## Starting on free plans

The system is tuned to start on the free tiers and upgrade only when traffic proves it is needed:

| Service | Free plan holds | Upgrade when |
| --- | --- | --- |
| Supabase | Viewers read one cached state (fast part every 2 s, slow part every 20 s at the CDN), so the database load does not grow with viewers. The engine keeps the project active, so it never pauses. | The usage page shows egress or database size above ~70% of the month's quota, or you want daily backups (Pro, $25/month). Upgrading takes minutes, no downtime. |
| Helius | The engine uses roughly 15,000 credits a day (fee checks every 45 s, chain re-read every minute, balances once a minute); players add about one credit per minute while connected plus a few per purchase. 1 webhook is included. If the 10 requests/second limit is hit, the site's RPC proxy retries on the public Solana RPC. | Credits used pass ~60% of the month, or 429 errors show up in the engine logs (Developer, $49/month). |
| Vercel | The free Hobby plan works technically. | Note: Hobby is meant for non-commercial use; switch to Pro ($20/month) once the project earns. |

## Before launch

- **Uptime monitor** (any free service, e.g. UptimeRobot): ping `https://<engine host>/health` every minute and email the team on failure.
- Two-factor authentication on every account; delete any deploy token used during development.

## Health

`GET /health` on the engine returns `{ ok, busy }`. The engine logs every round start, recovered fee and error; it keeps retrying if the database is briefly unreachable.
