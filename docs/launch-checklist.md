# Launch checklist

- [x] Rules, engine, site, database, 3D stage
- [x] Provably fair draw with public verification (`scripts/verify-round.mjs`)
- [x] Engine safety: resumable draws, idempotent payouts, credits, reserve, minute re-read of the chain
- [x] Full rehearsal on a local Solana chain ([report](rehearsal.md))
- [ ] Supabase Pro; uptime monitor on the engine's `/health`; two-factor authentication everywhere; delete the development GitHub token
- [ ] Wallets: prize, buyback, team, launch (Phantom), only public addresses shared
- [ ] Helius API key and webhook
- [ ] Engine on an always-on server, secrets set in the host's panel
- [ ] Site settings on Vercel; deployment protection off for production
- [ ] Prize wallet reserve (≈0.02 SOL from the team wallet)
- [ ] **Mainnet rehearsal:** throwaway token on pump.fun with fee sharing, tiny balloons, two clean rounds including fee distribution and a buyback
- [ ] Domain
- [ ] X account (bio, banner, pinned post) and the Ringmaster's pump.fun profile
- [ ] Launch $CIRCO, lock fee sharing, set the mint address everywhere, first three blue rounds
