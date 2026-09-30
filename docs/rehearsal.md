# Rehearsal report

**30 September 2026.** Before touching mainnet, the complete system ran on a local Solana chain: the real engine, the real site and a copy of the real database, with six bot wallets playing. Test SOL moved for real on that chain; nothing touched mainnet or the production database.

The kit is in [`scripts/rehearsal`](../scripts/rehearsal) and can be run again at any time.

## Setup

- `solana-test-validator` with the standard SPL Token and Memo programs
- Postgres with all migrations, served by PostgREST behind a Supabase-style URL
- A test $CIRCO token (6 decimals), six bots with 5,000,000 test $CIRCO each
- Small balloons (0.05 to 0.4 SOL) and short timers (15 s countdown, 6 s extensions)
- Fees simulated as SOL transfers to the prize wallet; the team's reserve top-up included on purpose

## What was tested

| Area | Scenario | Result |
| --- | --- | --- |
| Fees | Two fees reach the prize wallet with no webhook at all | Recovered by the minute re-read; exact jackpot split ✓ |
| Fees | The team tops up the prize wallet | Not counted as prize ✓ |
| Tickets | A burn the site never reported | Found on-chain and counted ✓ |
| Tickets | 12 tickets for one wallet | 10 given, 2 saved as credits and added next round ✓ |
| Tickets | A burn landing after sales close | Became a credit ✓ |
| Tickets | The same burn submitted twice | Counted once ✓ |
| Draw | Full round, 12 tickets | Winner and last buyer paid on-chain: 0.095 and 0.005 SOL, exact ✓ |
| Draw | **Engine killed after the winner's payment was sent but not confirmed** | On restart, every remaining payment was made; the on-chain count shows each payout **exactly once** ✓ |
| Draw | Burns seen by the engine out of order | Last-ticket bonus went to the true last burn on-chain ✓ |
| Mega Pop | Chance forced to 100% | Winner paid balloon + 0.105 SOL jackpot ✓ |
| Timer | Balloon not full after the time limit | Drawn with what it had ✓ |
| Postponement | 1 ticket against a minimum of 5 | Three extensions, then postponed; prize and ticket carried over ✓ |
| Guesses | Four guesses on a drawn balloon | The right one paid 2 tickets, the others lost ✓ |
| Guesses | Next balloon fixed by the rules | Every guess returned as 1 ticket ✓ |
| Guesses | A second guess in the same round | Turned into 1 ticket credit ✓ |
| Effects | Right price / wrong price | Recorded / rejected ✓ |
| Shooting gallery | Games through the engine and through the site | Fair result revealed with its secret ✓ |
| Shooting gallery | A 4th unpaid game | Blocked by the anti-spam limit ✓ |
| Teams | Weekly settlement, run twice | Right winner, 2 credits per active member, second run did nothing ✓ |
| Site | Nickname rules, forged signature, team switch limit, chat holder check and slow mode, team-panel ranges and permissions | All behaved as specified ✓ |
| Verification | `scripts/verify-round.mjs` on finished rounds | Commit, winner and Mega Pop recomputed ✓ |

## Bugs found and fixed

| # | Bug | Impact if launched | Fix |
| --- | --- | --- | --- |
| 1 | The daily gold guarantee counted "no gold yet" as "no gold in 24 hours" | Round 4 on launch day would have been a forced 5 SOL gold trophy | The guarantee starts only after the show has lived through its first 01:00 UTC checkpoint |
| 2 | The last-ticket bonus followed the order in which the engine *saw* burns | A burn recovered late could have taken the bonus from the true last buyer | Each burn stores its on-chain slot; the slot decides |
| 3 | The next balloon depended on the order the database stored the settings | The public verification would have shown a different balloon | Fixed order: green, blue, red, gold, with a test |
| 4 | The settings reload could turn into a retry loop | Stuck settings updates | Plain reload every minute |

Found earlier, before the rehearsal, by starting the full engine once: the pump.fun SDK's ES module build did not load under Node, which would have stopped the engine at launch. It is now loaded through its CommonJS build, and every engine module is checked to load.

## Not covered here

pump.fun's fee distribution and Jupiter buybacks exist only on mainnet. They are verified with a throwaway token on mainnet, running two clean rounds before launch (see [launch checklist](launch-checklist.md)).

## Added after the rehearsal

| Feature | Check | Result |
| --- | --- | --- |
| Lucky meter | Settled on the rehearsal's finished rounds, then settled again | Winners excluded, losing tickets counted, free tickets granted as credits, second run changed nothing ✓ |
| Graduation gala | The one-time "graduated" claim run twice | Claimed once, the second attempt did nothing ✓ |
| Smart buyback | Strategy unit tests (dip, deep dip, quiet support, drip, dust, chunks) | ✓ Live buys are checked in the mainnet rehearsal |
| Closing-block rule | A full draw on the local chain, then `verify-round.mjs` with the chain's RPC | Seed block = first block ≥ close + 2 s, previous block earlier ✓ |
| Timer | A balloon with no fees reached the 30-minute limit | **Bug:** it was drawn with a 0 SOL prize. Fixed: the timer only pops a balloon at least 25% full ✓ |
| Buyback v2 | 160 simulated days against a fixed clock ([report](buyback.md)) | 26–49% more tokens burned per SOL, ~10× fewer transactions ✓ |
