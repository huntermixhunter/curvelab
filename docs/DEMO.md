# Curve Lab demo kit

Rehearsal package included in the public source repository. The application
and deck are publicly deployed. No entry has been submitted.

Repository: https://github.com/huntermixhunter/curvelab

## Open the demo

Simulator: https://curvelab-lake.vercel.app

Pitch deck: https://curvelab-lake.vercel.app/demo/pitch.html

PDF deck: https://curvelab-lake.vercel.app/demo/pitch.pdf

For local rehearsal, run `npm ci` once in a fresh clone, then `npm run dev`.
The same routes are available at http://localhost:3000

The deck supports the arrow keys, Home, End, previous/next buttons, and printing.
All fonts, screenshots, and styles work locally without external services.

Saved presets belong to the browser and site origin. Use JSON export/import
to move experiments from localhost to the public demo.

## Reproduce the evidence

Run `npm run demo:evidence`. It makes no network requests. It verifies each
stored fixture before writing the measured report and four importable presets
to `docs/demo/`. It fails if a replay is inexact, a history is incomplete, the
documented launch is unavailable, or the comparison loses submitted demand.

`docs/demo/evidence.json` records fixture SHA-256 hashes, source commit, dirty
working-tree status, verified counts, exact comparison metrics, and boundaries.
The source commit identifies the simulation code used, not the generated
artifact's eventual commit. Counts in the deck describe this recorded snapshot.

## Three-minute walkthrough

Use these as talking points, not an on-camera script. Begin in a fresh browser
profile so an existing copy of the preset does not trigger the duplicate guard.

| Time | Action | Explain |
|---|---|---|
| 0:00-0:20 | Open the simulator. | A graduation target determines how much demand the DBC phase can absorb. Compare it before choosing a launch configuration. |
| 0:20-0:40 | Import `docs/demo/mainnet-graduation.curvelab.json`, then select Load. Close the library. | Every curve gets the same 245 recorded buys, totaling 28.843563996 SOL. |
| 0:40-1:10 | Point at Fill to graduation and the comparison table. | The 5.48 SOL design graduates at buy 1; the original config at buy 45; the 21.92 SOL design at buy 199. These are buys-only scenarios. |
| 1:10-1:35 | Inspect the demand accounting. | Filled, returned unfilled, and arriving after migration sum to all submitted demand. The first design fills 5.48 SOL, returns 2.74 SOL, and has 20.62 SOL arriving later. |
| 1:35-1:55 | Switch to Price multiple, then show the fees. | Fees combine partner and creator shares, valued at execution. The alternatives use standard allocation defaults; the original baseline retains its stored configuration. |
| 1:55-2:15 | Show `npm run verify` or the evidence file. | The actual launch included 246 sells and graduated at swap 491. Verification replays buys and sells; the counterfactual comparison omits sells on every curve. |
| 2:15-2:45 | Browse presets, Fork the imported example, change one target, save, export. | A portable experiment contains all demand and curve inputs. Another installation with this fixture can reproduce it. Synthetic starters need no fixture. |
| 2:45-3:00 | Return to the table. | This is working DBC design tooling. Builder pilots, a broader corpus, and a shared catalog are the next steps. |

## Expected reference results

These values come from the engine, not hand-entered mock results. See the
unrounded values in `docs/demo/evidence.json`.

| Scenario | Target SOL | Graduates at buy | Filled SOL | Returned SOL | Later SOL | DBC fee value SOL |
|---|---:|---:|---:|---:|---:|---:|
| Graduate sooner | 5.48 | 1 | 5.4800 | 2.7400 | 20.6236 | 0.01096 |
| Original config | 10.96 | 45 | 10.9600 | 0.0571 | 17.8265 | 0.02192 |
| Graduate later | 21.92 | 199 | 21.9200 | 0.0447 | 6.8788 | 0.04384 |

Designed alternatives match the source's price multiple, token decimals, supply,
base fee, and fee collection mode. They rebuild with zero vesting, no leftover
tokens, and the builder's default liquidity distribution. They are not clones
of the original config with only its target edited. For an isolated change,
fork a designed curve and change one control within the same builder defaults.

For this launch, buy-side fees are collected in base tokens. Their SOL values
are not cash payouts. The model holds orders fixed, excludes dynamic fees and
post-migration trading, and does not predict trader reactions or equity value.

## Recording and release

- The six-slide PDF is included in the public repository at
  `public/demo/pitch.pdf`.
- The walkthrough is ready to record; no narrated video is claimed.
- Check `docs/SUBMISSION.md` for verified requirements and outstanding fields.
- Public application hosting, outreach, and final submission still require
  the owner's release decision. No paid service is needed to rehearse.
