# We built a memecoin you can play

*Paste into an X Article. Upload the cover as the header image, then insert each image or video where marked.*

**Cover:** `00-cover.png`

---

Most memecoins give holders exactly one thing to do: watch the chart. Up, down, refresh, repeat.

We wanted something different. A coin with a game built into its fees. A show that runs day and night, where every trade matters to everyone watching, and where playing makes the coin scarcer.

This is **$CIRCO, the 24/7 memecoin circus.**

**[Image: `01-stage.png`]**

## It started with a balloon

A big, glossy balloon full of coins, inflating in real time with every trade. Everyone sees it grow. When it is full a countdown starts, the crowd rushes in, and then it pops. Someone walks away with everything inside.

That picture turned into the whole project.

## Where the prize comes from

Not from the team. Every $CIRCO trade on pump.fun generates creator fees, and pump.fun's fee sharing splits them automatically, locked at launch.

**[Image: `02-fees.png`]**

All three wallets are public. You can watch the money move.

## How you play

You enter by **burning** $CIRCO. One ticket costs 10,000 $CIRCO, and those tokens are gone forever. Each wallet can hold up to 10 tickets per round, so a single whale cannot own the wheel.

**[Image: `03-round.png`]**

When the balloon is full, a three-minute countdown begins. Sales close, the balloon pops, and the wheel spins. **95% of the prize goes to the winner, 5% to whoever bought the last ticket.** Payment is automatic, in SOL, straight to the winner's wallet. Then a new balloon appears.

If a round does not sell enough tickets, the countdown extends; if it still falls short, the round is postponed and its prize carries over. Nothing you burn is ever lost: tickets above the cap, or bought a moment too late, become credits for the next rounds.

**[Image: `04-balloons.png`]**

The show opens with three green balloons so the first winners arrive fast, and at least one gold trophy comes out every day.

## How our buyback bot buys

45% of every fee buys $CIRCO back and burns it. Most projects do this on a timer: every few minutes, whatever the price. That is easy for other bots to predict, and it spends the same at the top of a pump as at the bottom of a dump.

Ours waits for the moments where buying helps most.

**[Video: `06-buyback-bot.mp4`]** (GIF version: `06-buyback-bot.gif`)

- **It waits for a real dip.** A fall counts only if it is big for this chart, not normal memecoin noise, and it lasts more than one candle.
- **It buys in three steps.** 70% of its SOL is kept for dips and spent as the dip deepens: 25%, then 35%, then 40%.
- **It never catches a falling knife.** Each step waits until the price stops making new lows.
- **It supports quiet charts gently.** When trading goes quiet and the price slips, it makes one small buy every 20 to 40 minutes.
- **It never hoards and never dumps.** Above 10 SOL, or after a day without buying, it spreads the rest out over hours.
- **Nothing to front-run.** Random timing, uneven chunks, at most 2% price impact per chunk.

Everything it buys is burned, and the SOL it is holding for the next dip is shown live on the site. Over 160 simulated days it burned **26% to 49% more $CIRCO** for the same SOL than a timer, with ten times fewer transactions. The code and the simulation are public.

## Fair, and you can check it

A game with a prize is worthless if players cannot trust the draw.

**[Image: `05-fair.png`]**

Every round has a page that recomputes the winner in front of you, and a one-line script lets anyone check it on their own computer.

## More than a balloon

**[Image: `07-extras.png`]**

And every circus needs a host. Ours is a vinyl-toy Ringmaster who opens every round, reads the room ("it is almost full, snipers to your stations"), calls the winner by name, and does not appreciate tomatoes. He also lives in the coin's pump.fun chat: the two chats are one, so livestream viewers and players talk in the same place.

The day $CIRCO leaves the bonding curve, the circus throws a party: fireworks for everyone and a Grand Opening gold trophy.

## Tested before a single real SOL moved

**[Image: `08-tested.png`]**

Before launch we ran the entire circus on a test Solana chain: the real engine, the real site, a copy of the real database, and six bots buying tickets, playing and throwing tomatoes, round after round. Then we tried to break it.

We killed the engine in the middle of paying a winner. When it came back it finished the job, and the chain shows every payment landing exactly once. The rehearsal found five bugs, including one that would have opened launch day with a forced 5 SOL balloon. All fixed, all written down in the public rehearsal report.

## Open by default

The code, the rules, the fairness maths, the buyback simulation and the rehearsal report are on GitHub: **github.com/Nixway00/CIRCO**

## What's next

A final rehearsal on mainnet with a throwaway token, then the tent opens.

See you under the big top. 🎪

**The only real contract address will be posted from this account on launch day. Anything before that is fake.**

*$CIRCO is a memecoin. Its price can go to zero. Burned tokens cannot be recovered. This is not financial advice. Only play with what you can afford to lose.*
