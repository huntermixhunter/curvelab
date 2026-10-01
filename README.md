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

## Verified against mainnet

A simulator is only worth something if it reproduces launches that already
happened. Curve Lab pulls a real DBC pool off Solana mainnet and replays it
against its own on-chain config:

| pool | `7CSnmLkKq4XD1DRZW3FuLbS6xebpaDtg6j3zjzzkwt6U` |
|---|---|
| swaps replayed | 491 (245 buys, 246 sells) |
| lifetime | 88 seconds, 659 signatures, 164 of them failed |
| graduated | yes, on trade #491, at a 10.96 SOL migration target |
| result | **491 of 491 reproduced exactly** |

Exactly means every `nextSqrtPrice`, every `amountOut`, and every
`quoteReserve` is bit-identical to what the program wrote, across the whole
launch including graduation. `npm test` reruns this offline against the stored
fixture, so it cannot silently regress.

## The data problem nobody mentions

The first capture of that pool returned 154 swaps. The real number is 491.
The public endpoint had silently dropped 69% of the launch, and nothing about
the result looked wrong: the history was plausible, ordered, and completely
unusable.

`api.mainnet-beta.solana.com` is a pool of load-balanced nodes. It will omit
sub-responses from a batch without reporting an error, and it served 657
signatures on one read and 659 on the next for a token that stopped trading 88
seconds after launch. A missing trade is invisible, and every replay built on
it is quietly wrong.

So Curve Lab does not trust it. Every `EvtSwap2` carries the pool's quote
reserve immediately after that swap, straight from the program, which makes a
trade list self-checking: if one trade's effect on the reserve does not land on
the next trade's recorded reserve, a swap between them is missing. The backfill
detects gaps, re-reads to close them, recovers the order of trades sharing a
slot by search, and reports whatever it could not fix instead of hiding it.

Curve Lab proves its data is complete rather than asking you to trust it.

## Status

Engine complete, tested, and verified against mainnet. UI and the preset
marketplace are in progress.

```bash
npm install
npm test                                    # 23 passing, incl. the mainnet replay
npx tsx scripts/demo.mts                    # curve shape comparison
npx tsx scripts/backfill.mts discover       # find live DBC pools
npx tsx scripts/verify.mts --verbose        # replay stored pools against the chain
```

Set `SOLANA_RPC_URL` to use a private endpoint. The default needs no key and no
account, but expect repair rounds on a busy pool.

## Licence

MIT.
