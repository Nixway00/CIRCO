# The journey

## The idea

Memecoins live and die by attention. Most of them give holders one thing to do: watch the chart. We wanted a coin you could *play*, where the fees every trade generates became a show that never stops, and where playing made the coin scarcer.

The picture came first: a balloon, inflating in real time with every trade. Everyone watches it grow. When it is full, it pops, and someone walks away with what was inside.

## Turning a picture into rules

A balloon is a nice image; a game needs rules that survive real money and real players.

- **Where does the prize come from?** From creator fees, split by pump.fun's fee sharing, not from the team's pocket: 45% prize, 45% buyback and burn, 10% team.
- **How do you enter?** By burning $CIRCO. Every ticket makes the supply smaller.
- **What if nobody plays?** Ticket minimums, extensions, postponements that carry the prize forward, and a timer so a balloon never waits forever.
- **What stops whales from owning it?** A 10-ticket cap per wallet per round.
- **Why stay until the end?** The last ticket before sales close takes 5%.
- **Why come back tomorrow?** Four balloon sizes, and a gold trophy guaranteed every day.

## Fair or nothing

If players cannot check the draw, the game is worthless. We used commit and reveal: the hash of a secret goes public before any ticket is sold, the secret is mixed with a Solana blockhash nobody can predict, and everything is revealed after the pop. Anyone can recompute every winner with one command.

## Building the circus

- **The engine** runs the rounds, reads every burn on-chain, draws, pays and buys back. It was written to fail safely: payouts recorded before they are sent, draws that resume after a crash, burns that are never lost.
- **The stage** is a full 3D scene in the browser: a jelly balloon full of coins, a wheel, confetti and **the Ringmaster**, who opens every round, comments the tension and calls the winner by name.
- **The extras** make the waiting fun: a shooting gallery, guesses on the next balloon, a Mega Jackpot, stage effects everyone sees, and a weekly battle between the Clowns and the Acrobats.
- **The chat** joins the site with the coin's pump.fun chat, so livestream viewers and players talk in one place.

## Rehearsal before launch

Before a single real SOL moved, the whole system ran on a local Solana chain with bots playing round after round. We killed the engine in the middle of paying a winner to see what would happen (every payout still landed exactly once). The rehearsal found four bugs, including one that would have opened launch day with a forced 5 SOL balloon. All fixed, all documented in the [rehearsal report](rehearsal.md).

## What comes next

A final rehearsal on mainnet with a throwaway token, then the launch. After that, the circus grows with its crowd: more games, badges, and whatever the audience asks for loudest.
