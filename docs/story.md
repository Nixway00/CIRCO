<!-- Also published as an X Article. -->

## We built a memecoin you can play

Most memecoins give holders exactly one thing to do: watch the chart. Up, down, refresh, repeat.

We wanted something different. A coin with a game built into its fees. A show that runs day and night, where every trade matters to everyone watching, and where playing makes the coin scarcer.

This is **$CIRCO, the 24/7 memecoin circus.**

## One picture

It started with a balloon.

A big, glossy balloon full of coins, inflating in real time with every trade. Everyone sees it grow. When it is full a countdown starts, the crowd rushes in, and then it pops. Someone walks away with everything inside.

That picture turned into the whole project.

## Where the prize comes from

Not from the team.

Every $CIRCO trade on pump.fun generates creator fees, and pump.fun's fee sharing splits them automatically, locked at launch:

- **45% goes to the prize wallet**, which fills the balloons
- **45% goes to buyback**, and it is smart about it: instead of buying on a clock, it waits for dips and buys hard into them, supports the chart when trading goes quiet, and burns everything it buys
- **10% goes to the team** for servers and development

All three wallets are public. You can watch the money move.

## How you play

You enter by **burning** $CIRCO. One ticket costs 10,000 $CIRCO, and those tokens are gone forever. Each wallet can hold up to 10 tickets per round, so a single whale cannot own the wheel.

When the balloon is full a three-minute countdown begins. Sales close, the balloon pops, and the wheel spins: every ticket is one slice.

- **95% of the prize goes to the winner**
- **5% goes to whoever bought the last ticket** before sales closed

Payment is automatic, in SOL, straight to the winner's wallet. Then a new balloon appears, and it all starts again.

There are four balloons: a green balloon dog (0.5 SOL), a blue balloon (1 SOL), a red rocket (2 SOL) and a gold trophy (5 SOL). At least one gold trophy comes out every day.

If a round does not sell enough tickets, the countdown extends; if it still falls short, the round is postponed and its prize carries over. Nothing is ever lost, including your burns: tickets above the cap, or bought a moment too late, become credits for the next rounds.

## Fair, and you can check it

A game with a prize is worthless if players cannot trust the draw. So nobody, the team included, can choose or predict the winner.

1. When a round starts, we publish the hash of a secret. From that moment the secret cannot change without everyone noticing.
2. When sales close, we mix the secret with the blockhash of that Solana slot, which nobody can know in advance.
3. After the pop, we reveal the secret.

Every round has a page that recomputes the winner in front of you, and a one-line script lets anyone check it on their own computer.

## More than a balloon

Waiting for a balloon to fill should be fun too:

- **The shooting gallery**: burn $CIRCO for three shots at the balloons. Every pop is a ticket.
- **Guess the next balloon**: a right guess pays tickets for the next round.
- **The Mega Jackpot**: a small share of every fee builds a jackpot. Any draw can become a Mega Pop, and the winner takes it all.
- **Stage effects**: fireworks, a confetti storm, an air horn, gold rain, or a tomato straight at the Ringmaster's face. Everyone watching sees it, with your name on it.
- **Clowns vs Acrobats**: pick a team. Every week the team that burns more wins bonus tickets.

## The Ringmaster

Every circus needs a host. Ours is a vinyl-toy Ringmaster who opens every round, reads the room ("it is almost full, snipers to your stations"), calls the winner by name, and does not appreciate tomatoes.

He also lives in the coin's pump.fun chat, and the two chats are one: what you write during a pump.fun livestream shows up on the site, and the Ringmaster announces every winner there.

## Tested before a single real SOL moved

Before launch we ran the entire circus on a test Solana chain: the real engine, the real site, a copy of the real database, and six bots buying tickets, playing, guessing and throwing tomatoes, round after round.

Then we tried to break it. We killed the engine in the middle of paying a winner. When it came back, it finished the job, and the chain shows every payment landing exactly once.

The rehearsal found four bugs. One of them would have opened launch day with a forced 5 SOL gold balloon that could have taken hours to fill. All four were fixed, and every one of them is written down in the public rehearsal report.

## Open by default

The code, the rules, the fairness maths and the rehearsal report are all public on GitHub: **github.com/Nixway00/CIRCO**

## What's next

A final rehearsal on mainnet with a throwaway token, then the tent opens. After that the circus grows with its crowd: new games, badges, and whatever the audience cheers for loudest.

See you under the big top. 🎪

---

**The only real contract address will be posted from this account on launch day. Anything before that is fake.**

*$CIRCO is a memecoin. Its price can go to zero. Burned tokens cannot be recovered. This is not financial advice. Only play with what you can afford to lose.*
