# $CIRCO · The 24/7 memecoin circus

Every trade pumps the balloon. Every ticket burns $CIRCO. When it pops, someone wins.

## What is in here

| Folder | What it does |
| --- | --- |
| `supabase/migrations` | Database: rounds, tickets, fees, trades, chat, missions, config, leaderboards. Public read, engine-only write. |
| `engine` | The game engine (Node, TypeScript). The only process that writes game state and moves prize SOL. |
| `web` | The site (Next.js). Wallet connect, ticket burns, chat, daily mission, win pages with share images. |
| `scripts` | Run on your computer: create the three wallets, create the Helius webhook. |
| `launch/x-posts.md` | Bio, pinned post, launch thread and recurring posts for X. |
| `web/public/stage` | The 3D stage. With `?data=live` it shows only real data sent by `StageBridge`. |

## Setup

1. **Supabase:** create a project, run `supabase/migrations/0001_init.sql` in the SQL editor.
2. **Wallets:** on your own computer, `cd scripts && npm install && node new-wallets.mjs`. Keep the secrets offline and only in the engine's `.env`. Put the team wallet in `team_wallets`.
3. **Helius:** create an API key, then run `node scripts/helius-webhook.mjs` with the variables listed at the top of the file.
4. **Engine:** `cd engine && cp .env.example .env`, fill it in, `npm install`, `npm test`, `npm start`. Run it on an always-on server (a small VPS is enough) with `pm2 start ecosystem.config.cjs`, or with the included `Dockerfile`.
5. **Site:** `cd web && cp .env.example .env.local`, fill it in, `npm install`, `npm run dev`. Deploy on Vercel. The team panel is at `/admin` (wallets in `ADMIN_WALLETS`).
6. **Pump.fun:** launch $CIRCO, set creator fee sharing to 45% prize, 45% buyback, 10% team, then lock it.

## How a ticket is bought

1. The site builds one transaction: burn `tickets × price` $CIRCO + memo `CIRCO:<round>:<tickets>`.
2. The player signs it; the site sends only the signature to the engine.
3. The engine reads the transaction on-chain, checks mint, amount, signer, memo, round still open and the 10-ticket cap, then records the tickets.

## How the draw stays fair (commit and reveal)

1. When a round starts, the engine picks a random secret and publishes only `sha256(secret)` (`seed_commit`).
2. When sales close, the engine takes the blockhash of the closing slot, which nobody knows in advance.
3. Seed = `sha256(secret:blockhash:round)`. Winning ticket = seed modulo total tickets, with wallets sorted by address.
4. After the draw the secret is published. Anyone can check the commit and recompute the winner: the win page shows every value.

This is the method to write in the Rules section in place of `[METHOD TO DEFINE]`.

## Status

Done:
- [x] Database, public read, engine-only write, leaderboards
- [x] Game rules with tests (`cd engine && npm test`)
- [x] Ticket purchase: burn + memo from the site, on-chain verification in the engine
- [x] Fee distribution with the official `@pump-fun/pump-sdk` (permissionless, every 30 s)
- [x] Buyback bot: Jupiter swap SOL → $CIRCO, then burn, every 10 minutes
- [x] Commit-reveal draw, automatic payouts (95% winner, 5% last ticket)
- [x] Stage wired to real data (`/stage/index.html?data=live` inside `StageBridge`)
- [x] Buy, chat and daily mission from the stage through the connected wallet
- [x] Win pages with share images
- [x] Team panel at `/admin` for ticket price, chat minimum and balloons
- [x] X posting with automatic token refresh
- [x] History, Leaderboards and Profile in the stage from real data
- [x] Deployment kit: wallet script, Helius webhook script, pm2 and Docker
- [x] Supabase project live (organization CIRCO, free plan, Paris), both migrations applied, security check clean

Engine safety (done, migration `0003_engine_safety.sql`):
- [x] Draws resume after a restart; winner stored once, payouts written before they are sent (never paid twice)
- [x] Burns counted from the Helius webhook too, so closing the browser loses nothing; burns after sales close become credits
- [x] 10-ticket cap enforced inside the database (tested with 30 simultaneous purchases); extra tickets become credits
- [x] Fees that arrive during countdown or draw, and overflow above capacity, roll into the next balloon
- [x] 0.01 SOL reserve always kept in the prize wallet for network fees (fund it with ~0.02 SOL before launch)
- [x] Ticket price and chat minimum on the stage follow the config
- [x] Stats, leaderboard and history served from a snapshot refreshed every 15 s
- [x] Chat anti-spam (one message every 4 s, no repeats)

Minigames (migration `0004_games.sql`):
- [x] Shooting gallery: burn 10,000 $CIRCO for 3 shots, 30% hit chance each, every hit = 1 ticket (0.9 tickets per 10,000 on average, so buying directly stays slightly cheaper)
- [x] Fair: the engine commits to a secret before the burn; the result is sha256(secret:burn signature), revealed after the game
- [x] Daily cap of 5 game tickets per wallet (config `game_daily_ticket_cap`); game tickets respect the 10-per-round cap, extras become credits
- [x] Game burns settled from the Helius webhook too, so closing the page loses nothing

Personality (migration `0005_profiles.sql`):
- [x] The Ringmaster comments the whole round in his speech balloon (new balloon, 50%, 90%, full, last 10 seconds, extensions, big buys, pop, postponement, gold night)
- [x] Winner announced by name: "Congratulations, <nickname>!" on the stage, in the chat and on X
- [x] Nicknames are required: the first time a wallet buys, chats, plays or claims the mission, a window asks for one (3-16 letters/numbers/_, unique, reserved words blocked, change once a day)
- [x] Optional "Link X" in Profile (OAuth 2.0 with PKCE, read-only): the @handle is shown instead of the nickname; one X account per wallet; unlink any time (migration `0006_x_link.sql`)
  - To switch it on: in the X developer portal enable OAuth 2.0 for the app (type Web App), add the callback `https://<site>/api/x/callback`, then set `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI` in Vercel

Show features (migration `0007_show_features.sql`):
- [x] Mega Jackpot: 5% of every prize-wallet fee (`jackpot_share`) builds a jackpot shown on the stage; each draw has a 2% chance (`jackpot_chance`), decided by the same verifiable seed, to be a Mega Pop that also pays the whole jackpot to the winner
- [x] Paid stage effects for everyone to see, with the buyer's name: fireworks, confetti storm, air horn, tomato at the Ringmaster, gold rain (`fx_prices`, pure burn)
- [x] Teams: Clowns vs Acrobats, chosen with the nickname; weekly score = tokens burned by members; every active member of the winning team gets `team_reward_tickets` credits
- [x] Guess the next balloon: one guess per round (`pick_price_tokens`), payout fixed at guess time with expected value `pick_return` of the stake; the next balloon is now drawn from the previous round's revealed seed, so anyone can check it; forced balloons (first rounds, gold guarantee) refund every guess as 1 ticket

pump.fun chat (migration `0008_pumpfun_chat.sql`):
- [x] The engine joins the coin's pump.fun live chat (unofficial socket.io protocol, tested live) and every message appears in the site chat with a green "pump.fun" tag
- [x] The Ringmaster speaks on pump.fun as the launch wallet (`RINGMASTER_WALLET_SECRET`): the engine signs pump.fun's own login message, refreshes the session twice a day, and announces winners and Mega Pops in the coin's chat with the creator badge (tested live: login and chat authentication both accepted)
- [x] Switch off any time with config `pumpfun_chat_relay = false`; if pump.fun changes its protocol only the relay stops, the game is unaffected

Engine start-up (fixed): the pump.fun SDK's ESM build failed to load under Node; it is now loaded through its CommonJS build, and every engine module is verified to load with plain type stripping.

Still to do before launch:
- [ ] **End-to-end test on a throwaway token** with tiny balloons (set `balloons` capacities to 0.05 SOL in `config`).
- [ ] **Deploy:** engine on a VPS (for example with `pm2`), site on Vercel, Helius webhook pointed at the engine.

## Monthly running costs (estimate)

| Item | Cost | Note |
| --- | --- | --- |
| Helius RPC, Developer plan | $49 | Webhooks and 50 requests/s |
| Engine server (small VPS) | about €5–15 | Always on |
| Supabase | free tier at first, then Pro | Upgrade when traffic grows |
| Vercel | free at first, Pro for commercial use | |
| X API, auto-post every pop | about $0.015 per post without a link | A post with a link costs $0.20, so links stay out of the posts |
| X API, mission check (optional) | $0.005 per post read | |
| Domain | about €15 per year | |

Roughly €80–130 per month at launch, inside the €50–200 budget.

## Four-week plan

| Week | Goal |
| --- | --- |
| 1 | Supabase, wallets, engine running on a server, test token on Pump.fun with fee sharing |
| 2 | Fee claiming, ticket burns end to end, draw and payouts on tiny balloons (0.05 SOL) |
| 3 | Stage wired to real data, buyback bot, chat and mission live, win pages |
| 4 | Two clean rounds in a row on the test token, domain, X account, then launch $CIRCO |
