# Curve Lab

**Design a Meteora Dynamic Bonding Curve before you launch on it.**

Today every launchpad operator picks a bonding curve blind. You choose a start
market cap, a migration market cap, and a fee, then you find out whether it was
right by watching a real token succeed or fail with real money on it.

Curve Lab replays a curve against a demand flow and shows you what actually
happens: the price path, when it graduates to DAMM v2, how much fee revenue the
creator earns, and how much buy demand arrives after graduation and never
touches your curve at all.

## The tradeoff nobody can currently see

Same demand (120 buys of 1 SOL), three curve shapes:

| curve | graduates at | creator fee | final mcap | demand stranded |
|---|---|---|---|---|
| Tight, 30 to 300 mcap | trade #73 | 0.582 SOL | 300 SOL | **47 SOL** |
| Normal, 30 to 600 mcap | trade #110 | 0.880 SOL | 594 SOL | 10 SOL |
| Long, 30 to 2000 mcap | never | 0.960 SOL | 720 SOL | 0 SOL |

A tight curve graduates fast and feels like a win, but 47 of 120 SOL of demand
arrived after the curve was finished and routed to the DAMM v2 pool instead,
earning the creator nothing on the way up. A long curve captures every fee but
never migrates. The middle is where most launches should sit, and until now
there was no way to find it except by launching.

## How it works

Curve Lab does not reimplement the bonding curve. It calls Meteora's own
exported math from `@meteora-ag/dynamic-bonding-curve-sdk`, so a simulated curve
is the same curve you get on mainnet.

The SDK exposes `getQuoteFromInputAmount` for pricing a swap before a pool
exists, but it rebuilds a launch-state pool on every call, so it can only ever
price the *first* trade. Curve Lab owns the virtual pool state and rolls it
forward with each quote's `nextSqrtPrice`, which is what turns a single quote
into a price path.

Three pieces of real DBC behaviour the engine models, each found by running the
SDK rather than reading about it:

1. **Graduation halts the curve.** Once `quoteReserve` reaches
   `migrationQuoteThreshold` the program refuses swaps. Demand after that point
   is recorded separately rather than silently simulated.
2. **The last buy partially fills.** Approaching the threshold the curve has
   less capacity than the trader wants to spend. `swapQuoteExactIn` throws;
   the program fills to the cap and refunds the rest. Buys use partial-fill.
3. **A built config is not directly quotable.** `poolFees.dynamicFee` is `null`
   on a fresh `buildCurve` output and `migrationSqrtPrice` is absent. The SDK
   reconciles this in a private method, which Curve Lab reimplements.

## Status

Engine complete and tested. UI, mainnet data backfill, and the preset
marketplace are in progress.

```bash
npm install
npm test            # 9 passing
npx tsx scripts/demo.mts
```

## Licence

MIT.
