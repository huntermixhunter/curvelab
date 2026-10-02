# Curve Lab

**Design a Meteora Dynamic Bonding Curve before you launch on it.**

Today every launchpad operator picks a bonding curve blind. You choose a start
market cap, a migration market cap, and a fee, then you find out whether it was
right by watching a real token succeed or fail with real money on it.

Curve Lab replays a curve against a demand flow and shows you what actually
happens: the price path, when it graduates to DAMM v2, the combined partner and
creator DBC fees, and how much buy demand arrives after graduation and never
touches your curve at all.

## The tradeoff nobody can currently see

Same demand (120 buys of 1 SOL), three curve shapes:

| curve | graduates at | partner + creator DBC fee | final mcap | demand after graduation |
|---|---|---|---|---|
| Tight, 30 to 300 mcap | trade #73 | 0.582 SOL | 300 SOL | **47 SOL** |
| Normal, 30 to 600 mcap | trade #110 | 0.880 SOL | 594 SOL | 10 SOL |
| Long, 30 to 2000 mcap | never | 0.960 SOL | 720 SOL | 0 SOL |

A tight curve graduates quickly, leaving 47 of 120 SOL of submitted demand
outside the DBC simulation. A longer curve can collect more DBC fees but may
never migrate under this demand. DAMM v2 trading and fees after migration are
not modeled, so this is a comparison of the bonding-curve phase, not total
lifetime revenue or a prediction of real trader behavior.

## Rerun a launch that already happened

The interesting question is not what a curve does to invented demand. It is what
a *different* curve would have done to demand that really arrived.

Curve Lab takes the buy flow off a verified mainnet launch and runs it through
curves that never existed. Pool `7CSn…wt6U` took 28.8 SOL of buy orders across
245 trades:

| curve | graduated | through curve | returned unfilled | after graduation | DBC fee value |
|---|---|---|---|---|---|
| Graduate at 5.48 SOL | trade #1 | 5.48 SOL | 2.74 SOL | 20.62 SOL | 0.01096 SOL |
| Original curve, 10.96 SOL | trade #45 | 10.96 SOL | 0.0571 SOL | 17.83 SOL | 0.02192 SOL |
| Graduate at 21.92 SOL | trade #199 | 21.92 SOL | 0.0447 SOL | 6.88 SOL | 0.04384 SOL |

In the buys-only scenario, the original curve graduates on trade 45 of 245 and
collects fees valued at 0.02192 SOL. Doubling its migration target to 21.92 SOL
collects fees valued at 0.04384 SOL. These are combined partner and creator
fees valued at each trade's execution rate. Under output-token fee collection,
the actual fee proceeds are base tokens, not a guaranteed SOL payout.
The first buy alone was 8.2 SOL, 75% of the whole migration target, which is why
the shortest curve graduates on trade one and collects almost nothing.

Sells are dropped from both sides. A sell is denominated in base tokens, so how
many a holder has depends on the curve they bought on; buy demand is in SOL and
transfers between curves unchanged. Holding the orders identical is the only
thing that makes the comparison mean anything.

The demand chart and table account for the full submitted amount: filled
quote, quote returned unfilled at graduation, and orders arriving afterward.
The actual on-chain launch includes sells and graduates at trade 491, as
shown in the verification section below.

## Market caps are the wrong control

The SDK builds a curve from a start market cap and a migration market cap, and
those are the two numbers every launchpad UI exposes. They are close to useless
for deciding anything.

The threshold a pair of market caps implies depends on how much *base supply*
the curve sells on the way up, which is set by leftover, locked vesting, and the
liquidity split. The pool above starts at a 305 SOL market cap and migrates at
500, and needs 11 SOL to graduate. The same two market caps with a standard
full-supply configuration need 187 SOL. Nothing about the pair tells you which.

So Curve Lab inverts it and exposes the two decisions that do carry meaning:

- **SOL to graduate**: how much buy demand the curve must absorb before it migrates.
- **Curve length**: how far the price runs from start to migration, as a multiple.

At a fixed length the threshold is exactly linear in the market-cap level, so
the inversion is one build and a division rather than a search. It reproduces
any target to within 1e-6 from 1 SOL to 3,000 SOL, and `npm test` holds it there.

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

## Running it

```bash
npm install
npm run dev                  # the lab, at http://localhost:3000
npm test                     # offline regression suite and stored mainnet replays
npm run build                # production build
```

The comparison UI supports real buy flows, three synthetic demand shapes,
up to three designed curves, indexed progress and price charts, DBC fee
valuation, and full quote accounting. A free preset library saves complete
experiments with their demand settings, descriptions, and intended uses.

### Preset library

Open **Browse presets** for three built-in comparisons:

- **The graduation tradeoff:** 40 versus 85 SOL migration targets with matching
  curve length and fees.
- **Same target, different climb:** 5x, 20x, and 80x price ranges against the
  same gradual demand.
- **Fee sensitivity:** 0.25%, 1%, and 2% fees with buy demand held fixed.

**Load** restores the full experiment. **Fork** loads a starter or saved
experiment and opens a form for a new copy, preserving the source name and ID.
Change the simulator controls, add a name and notes, then save. **Save current**
also captures comparisons built directly in the lab. Saving waits for a
successful simulation of the current settings, including every curve.

Presets persist in this browser and site origin, with a limit of 100 saved
experiments. Reloading retains the library; loading a saved experiment is
explicit. **Export JSON** creates a portable `.curvelab.json` file, and
**Import JSON** adds it to another browser's library. Export current work from
the save form even if browser storage is unavailable. There are no accounts,
paid listings, deployment actions, or wallet connections in this milestone.

The version 1 format stores `format`, `version`, `id`, `name`, `description`,
`useCase`, `createdAt`, optional `forkedFrom`, and a `simulation` request with
every curve and its demand source. It is a Curve Lab simulation input, not a
Meteora SDK deployment configuration. Imports are limited to 64 KB and checked
for format version, numeric bounds, unique curve IDs and color slots, matching
token supplies, and valid demand fields. Unsupported versions, malformed
files, and duplicate IDs produce an error without overwriting the library.

Synthetic presets work without launch data. Mainnet presets reference their
original pool address and need that verified history on the destination
installation. Missing histories block loading without substituting demand;
the saved preset can still be exported. Unreadable browser storage is left
untouched. Keep exported files as backups before clearing browser data.

For a short demo, load **The graduation tradeoff**, inspect migration timing
and unfilled demand, fork it, change one graduation target, and save. Export
the fork and import it in a fresh browser to reproduce the comparison.

The corpus currently contains three exactly replayed histories (493 swaps).
One is available in the UI. Two single-swap fixtures exceed the designer's
curve-length range and remain available to offline verification. The picker
excludes unsupported parameter ranges, non-SOL quote assets, dynamic-fee
configs, and histories over 6,000 buys rather than truncating or mislabeling them.

Collecting launches to replay against:

```bash
npm run capture              # discover and backfill verified pools, unattended
npm run verify -- --verbose  # replay every stored pool against the chain
npm run demo                 # curve shape comparison, no browser
```

`npm run capture` accepts nonempty histories only when the reserve chain is
continuous and every recorded swap replays exactly. Unsupported fees and
incomplete or mismatching histories are parked in `data/pools-incomplete`.
Fixtures are written atomically so the server never reads half a JSON file.
New eligible fixtures appear on page refresh without restarting the server.

The collector uses a PID lock to prevent overlapping jobs. It samples 120
transactions per discovery round by default, uses batches of four, logs progress
to `data/capture.log`, backs off on rate limits, and times out stalled HTTP
requests after 30 seconds. `--target`, `--sample`, `--max-pages`, `--rounds`, and
`--cooldown` control a run. An exited process's lock is recovered automatically.

### A note on the public RPC

The default endpoint, `api.mainnet-beta.solana.com`, needs no key and no
account, and it is the reason this runs for anyone who clones it. It is also
rate-limited hard enough that building a corpus of more than a few pools is slow:
discovery reads a few hundred transactions to find which pools are live, and the
endpoint starts refusing requests partway through. The capture job backs off and
retries rather than failing, but it takes its time.

`SOLANA_RPC_URL` can select another endpoint. Its rate limits and billing apply;
the default needs no paid account.

## Licence

MIT.

## Demo and submission materials

The rehearsal guide is in `docs/DEMO.md` and the submission draft is in
`docs/SUBMISSION.md`. Open the six-slide deck at
http://localhost:3000/demo/pitch.html with the dev server running, or use
`public/demo/pitch.pdf`. These are local review materials, not a submitted entry.

`npm run demo:evidence` verifies the stored corpus offline and writes fixture
hashes, measured comparison results, and four portable examples to `docs/demo/`.
The mainnet example explicitly preserves the original config as its baseline;
designed alternatives use standard builder allocations, not the original
launch's vesting and liquidity distribution.
