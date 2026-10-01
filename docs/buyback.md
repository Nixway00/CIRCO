# Buyback and chart support

45% of every creator fee goes to the buyback wallet. Everything it buys is burned. The question is *when* to buy, because the same SOL can burn very different amounts of $CIRCO.

## Why not buy on a fixed clock

A buyback every 10 minutes is simple and predictable, and that is the problem: bots learn the clock, buy just before it and sell into it. It also spends the same amount at the top of a pump as at the bottom of a dump.

## Version 1, and what the stress test found

The first smart version bought 40% of its SOL whenever the price fell 12% from the 30-minute high, 80% on a 24% fall, and supported quiet charts with 10% buys. We ran it on 160 simulated memecoin days (four market types, three 25-minute dumps a day, fees arriving all day):

| Problem | What happened |
| --- | --- |
| Memecoin noise looked like dips | On a wild chart it bought **169 times a day**, no better than the fixed clock |
| Catching knives | On calm charts **49%** of its SOL went into the first half of a dump, before the bottom |
| Quiet support bled the treasury | 10% every few minutes on a quiet chart is most of the wallet within an hour |
| The drip dumped | Above the holding cap it released 15% every few minutes |

## Version 2 (live)

| Rule | How it works |
| --- | --- |
| **Dips are relative** | A dip is a fall of at least 12%, or twice the chart's typical 30-minute swing if that is larger (capped at 35%). Normal noise on a wild chart is not a dip. |
| **One wick is not a dip** | The fall must persist for two samples in a row. |
| **A ladder, not a bet** | 70% of the SOL on hand is the dip budget. A dip episode buys it in three tranches: 25% at the first level, 35% at 1.7× that fall, 40% at 2.5×. |
| **Wait for the fall to stop** | A tranche fires only when the price is no longer making new lows (or has fallen 8 points past the level). |
| **Episodes end** | When the price recovers half of the first level, or after 3 hours. |
| **Gentle quiet-chart support** | Only when fewer than 5 SOL traded in 30 minutes and the price is 3% under its hourly average: one buy of 15% of the flow budget (the other 30%), at most every 20 to 40 minutes. |
| **No hoarding, no dumping** | Above 10 SOL, or 24 hours without a buy, a third of the excess is bought every 20 minutes. |
| **Nothing to front-run** | Levels carry ±10% random jitter, buys are split into 2-4 uneven chunks at random moments, 3-8 minutes of random pause between buys, and each chunk is capped at 2% price impact. |
| **Survives restarts** | The dip episode and the pacing clocks are stored, so a restart never repeats a tranche. |

## Results

Same 160 simulated days, tokens burned per SOL compared with the fixed clock:

| Market | Fixed clock | Smart v2 | Buys per day (clock → v2) |
| --- | ---: | ---: | ---: |
| Calm, busy | 100% | **130%** | 144 → 13 |
| Normal memecoin | 100% | **127%** | 144 → 15 |
| Wild memecoin | 100% | **149%** | 144 → 16 |
| Quiet, drifting | 100% | **126%** | 144 → 22 |

Between a quarter and a half more $CIRCO burned for the same SOL, with about ten times fewer transactions. The price is holding SOL in reserve for the next dip (7 to 12 SOL at the end of a simulated day); that reserve is shown live on the site as "SOL for dips", so everyone can see the buy wall waiting.

Run the simulation yourself:

```bash
node --experimental-strip-types engine/sim/buyback-sim.ts
```

The strategy is [`engine/src/buybackStrategy.ts`](../engine/src/buybackStrategy.ts), covered by nine tests in `engine/test/buyback.test.ts`. Every threshold can be tuned from the team panel.

Simulations are not the market: real dumps can be deeper or longer than the ones simulated. The strategy is built so that a bad call costs one tranche, not the treasury.
