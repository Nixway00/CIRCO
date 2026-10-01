# Security

## Who holds what

| Key | Where | Can do | Holds |
| --- | --- | --- | --- |
| Prize wallet | Engine server only | Pay winners | The current prizes, the jackpot (capped at 25 SOL) and a 0.01 SOL reserve |
| Buyback wallet | Engine server only | Swap SOL for $CIRCO and burn it | SOL waiting for the next dip: at most 10 SOL, never more than 24 hours |
| Team wallet | Offline (team) | Nothing automatic | The team's 10% |
| Launch wallet | Engine server (optional) | Speak in the pump.fun chat as the Ringmaster; can also be the buyback wallet, so buybacks show as creator buys on pump.fun | A little SOL, plus the buyback's SOL waiting for the next dip if it doubles as the buyback wallet |
| Database service key | Engine server and site server | Write game data | — |

Private keys never enter the site, the repository or any chat. They are set only in the hosting panels' secret settings.

**Fee sharing is locked at launch**, so no key can redirect the creator fees afterwards.

## What players sign

- Ticket, game, guess and effect purchases: one transaction that **burns** an exact amount of $CIRCO with a short memo. Nothing else, no approvals, no transfers to us.
- Nickname, team, chat and profile: a plain text message (`action:wallet:time[:details]`), never a transaction. It is valid for 5 minutes.

The site never asks for a seed phrase or a private key. Nobody from the team will ever ask for one.

## Server-side checks

- Every burn is re-read on-chain: mint, amount, signer, memo, round, cap.
- Every signed message is checked against the wallet and a 5-minute window.
- Chat: holder check, one message every 4 seconds, no repeats within a minute.
- Shooting gallery: at most 3 unpaid games per wallet and 500 overall in any 10 minutes; unpaid games expire after an hour.
- Team panel: admin wallets only, signed requests, range check on every setting.
- Database: row-level security everywhere; secrets live in tables the public cannot read; sensitive functions can be called only by the engine.

## Accounts

Two-factor authentication on GitHub, Vercel, Supabase, the engine's host, Helius and X. Deploy tokens are created for a task and deleted after it.

## Reporting a problem

If you find a vulnerability, please contact the team privately through the X account's direct messages before disclosing it. We will answer, fix it, and credit you if you want.

**Bug bounty.** A valid report that could have cost players or the project money is rewarded in SOL, sized to the impact (from a thank-you for minor issues to a meaningful reward for anything that could move funds or change a draw). Testing must not touch real players' funds; a report of a test on the rehearsal kit is welcome.
