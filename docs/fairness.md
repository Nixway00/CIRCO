# Provably fair

The team cannot pick the winner, and cannot know it in advance. Every value needed to check a round is public.

## Commit and reveal

1. **Round start.** The engine draws a random 32-byte secret and publishes only its hash, `seed_commit = sha256(secret)`. From this moment the secret cannot change without everyone noticing.
2. **Sales close.** The seed uses the blockhash of a block fixed by a public rule: **the first finalized Solana block at least 2 seconds after sales closed**. Nobody can know that blockhash beforehand, and the engine cannot choose it by waiting: anyone can check that the block's time is at or after the target and that the block before it is earlier.
3. **Seed.** `seed = sha256(secret + ":" + blockhash + ":" + roundId)`.
4. **Reveal.** After the draw the secret is published next to the blockhash and the slot.

## What the seed decides

| Result | How |
| --- | --- |
| **Winning ticket** | `BigInt("0x" + seed) mod totalTickets`. Tickets are laid out wallet by wallet, wallets sorted by address, each wallet owning a run as long as its ticket count. |
| **Mega Pop** | `u32(sha256(seed + ":mega")) / 2^32 < jackpot_chance`, and the jackpot is not empty. |
| **Next balloon** | `r = u32(sha256(seed + ":balloon")) / 2^32`, walked over the weights in the fixed order green, blue, red, gold. Not used when the first rounds or the gold guarantee fix the balloon. |

`u32(x)` is the first four bytes of the hash, read as a big-endian unsigned integer.

Postponed rounds reveal their secret and seed too, because their seed draws the next balloon.

The verification script also checks the closing-block rule when it can reach a Solana RPC that serves old blocks (`SOLANA_RPC=... node scripts/verify-round.mjs 42`).

## Check a round yourself

Every finished round has a win page (`/win/<round>`) that recomputes all of the above and marks each check with ✓. Or run it on your own machine, with nothing to trust but the public data and the maths:

```bash
node scripts/verify-round.mjs 42
```

The script downloads the round and its tickets from the public database, checks the commit, and recomputes the winner, the Mega Pop and the next balloon.

## Why the blockhash matters

If the engine alone chose the seed, it could pick a secret that favours a wallet. With the commit published first, the secret is fixed before any ticket is sold; with the blockhash mixed in, the final seed is unknown until the very end. Neither the team nor a player can steer it.

## The shooting gallery

Same idea, per game: the engine commits to `sha256(secret)` before you burn; the result is `sha256(secret + ":" + your burn signature)`; the secret is revealed right after the game.
