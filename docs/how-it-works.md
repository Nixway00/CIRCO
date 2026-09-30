# How $CIRCO works

The same rules shown on the site, in one place. Numbers are the launch values; the team can change some of them from the team panel, announcing it on X first.

## 1. Fees fill the balloon

Every $CIRCO trade on pump.fun generates creator fees. Fee sharing splits them automatically:

- **45%** to the prize wallet. Of this, 5% builds the Mega Jackpot and the rest fills the balloon.
- **45%** to the buyback wallet. It does not buy on a fixed clock that bots could front-run: it buys dips in three steps as they deepen, waiting each time for the price to stop falling; it supports the chart gently when trading is quiet; and it never waits more than a day or on more than 10 SOL. Everything it buys is burned, the SOL it holds for the next dip is shown on the site, and the Ringmaster announces the dip buys. Details and simulation results: [buyback](buyback.md).
- **10%** to the team.

All three wallets are public. Fees that arrive while a countdown or draw is running, and anything above a balloon's size, roll into the next balloon. When trading is fast, the stage shows how much SOL is already queued for the next balloons.

## 2. The balloons

| Balloon | Prize | Share of rounds | Ticket minimum |
| --- | ---: | ---: | ---: |
| Green balloon dog | 0.5 SOL | 40% | 50 |
| Blue balloon | 1 SOL | 35% | 100 |
| Red rocket | 2 SOL | 20% | 150 |
| Gold trophy | 5 SOL | 5% | 300 |

- The first three rounds are always the green balloon dog (0.5 SOL), so the show starts fast.
- **Gold guarantee:** every day at 01:00 UTC, if no gold trophy came out in the previous 24 hours, the next balloon is a gold trophy.
- Otherwise the next balloon is drawn from the previous round's revealed seed, so it can be checked (see [fairness](fairness.md)).

## 3. Tickets

- One ticket costs **10,000 $CIRCO**, **burned** when you buy.
- Up to **10 tickets per wallet per round**.
- Tickets are sold while the balloon inflates and during the countdown. Sales close when the countdown ends.
- Nothing you burn is lost: tickets above the cap, or bought a moment after sales closed, become **credits** added automatically at the start of the next rounds.

## 4. Countdown, minimum, postponement

- When the balloon is full, a **3-minute countdown** starts. If it is not full after 30 minutes, the countdown starts anyway with the prize collected so far, as long as the balloon is at least a quarter full (an almost empty balloon keeps inflating).
- If the balloon's ticket minimum is not reached, the countdown extends by 1 minute, up to 3 times.
- Still under the minimum: the round is **postponed**, and its prize and tickets carry over to the next round. After three postponements in a row, the next round is drawn anyway.

## 5. The draw

- Every ticket is one slice of the wheel.
- **95%** of the prize to the winner, **5%** to the buyer of the last ticket before sales closed (free tickets cannot take this bonus).
- Payouts are automatic; every transaction is linked from the round's win page.
- Team wallets can play like anyone else and are labelled as team wallets.

## 6. Mega Jackpot

- 5% of the fees reaching the prize wallet build the Mega Jackpot, shown live on stage.
- Every draw has a **2% chance** to be a **Mega Pop**: the winner also takes the whole jackpot.
- The Mega Pop is decided by the same seed as the wheel.

## 7. Shooting gallery

- Burn 10,000 $CIRCO for **3 shots**, each with a **30%** chance to pop a balloon. Every pop is 1 ticket for the current round.
- On average a game returns 0.9 tickets, so buying tickets directly stays slightly cheaper.
- Up to 5 game tickets per wallet per day.
- The result is decided by a secret committed before your burn, mixed with your burn signature, and revealed after the game.

## 8. Guess the next balloon

- One guess per round, 10,000 $CIRCO, burned. Guesses close with ticket sales.
- A right guess pays tickets for the next round: green 2, blue 2, red 4, gold 18.
- On average a guess returns 90% of its cost in tickets: less than buying tickets directly.
- If the next balloon is fixed by the rules (first rounds or the gold guarantee), every guess comes back as 1 ticket.

## 9. Lucky meter

- Every ticket you buy in a round you do not win fills your lucky meter.
- Every **20 losing tickets** you get **1 free ticket**, added automatically to the next round. The meter is shown under your tickets.

## 10. Graduation gala

When $CIRCO completes its pump.fun bonding curve and moves to PumpSwap, the circus throws a party: fireworks and gold rain for everyone watching, and the next balloon is a **Grand Opening gold trophy**.

## 11. Stage effects

Burn a little $CIRCO to launch an effect that everyone watching sees, with your name on it: fireworks, a confetti storm, an air horn, a tomato at the Ringmaster, gold rain. Effects are pure burn and give no tickets.

## 12. Clowns vs Acrobats

- Pick a team when you join; you can switch once a week.
- Every Monday 00:00 UTC, the team whose members burned more $CIRCO that week wins: each member who burned something gets **2 bonus tickets** for the next rounds.

## 13. Daily mission

Share a round on X and paste the link: 3 bonus tickets, once a day. Bonus tickets burn nothing but count toward the cap and the round minimum.

## 14. Names and chat

- A nickname is required to play and is shown instead of your wallet. You can link your X account and show your @handle instead.
- Anyone can read the chat; wallets holding at least 10,000 $CIRCO can write. Messages from the coin's pump.fun chat appear too, tagged "pump.fun". The Ringmaster announces winners there as well.

## Risks

$CIRCO is a memecoin: its price can drop to zero. Burned tokens cannot be recovered. Nothing here is financial advice.
