# Curve Lab checkpoint: 2026-10-01

Project: `C:\Users\mixma\Documents\curvelab`.

## Finished in this milestone

- Comparison UI and server simulation API, including real buys-only demand and
  flat, front-loaded, and organic synthetic demand.
- Graduation-target and curve-length controls, indexed charts, DBC fee
  valuation, partial-fill refunds, and comparison table.
- Capture loop with progress logging, conservative batching, process lock,
  HTTP timeouts, atomic fixture writes, and exact-replay admission checks.
- Three stored histories replay all 493 swaps exactly, including reserves on
  both buys and sells. One history is within the UI's supported curve range.
- Root-only scratch ignore preserves every nested `__tests__` directory.

## Validation

- 70 tests passed across 9 files.
- Typecheck, ESLint, and Next.js production build passed.
- Browser interaction checks covered chart switching, adding/removing curves,
  minimum curve length, all synthetic shapes, and maximum demand.
- No page overflow at 360, 420, 768, or 1440 pixels. No browser runtime errors.

## Running locally

- Development UI: http://localhost:3000
- Capture command: `npm run capture -- --target 10 --sample 120 --max-pages 30 --rounds 12 --cooldown 90`.
- The current capture uses the free public Solana endpoint explicitly. Check
  `data/capture.log` and `data/capture.lock` for progress and worker PID.
- The capture target is ten accepted histories, not a promise of ten UI-eligible
  comparisons. Public RPC throttling still limits collection speed.
- Three old overlapping collectors were stopped before starting the guarded run.

## Remaining product work

1. Preset catalog with save, load, fork, and portable config export.
2. Collect a broader set of UI-eligible mainnet launch histories.
3. Submission framing and demo. Recheck official terms before submission.

## Model boundaries

This milestone models the DBC phase and holds buys fixed across curves. It does
not predict trader behavior, model post-migration DAMM fees, implement dynamic
fee state, or execute transactions. Fee values combine partner and creator
shares; base-token fees are valued in SOL at each trade's execution rate.
