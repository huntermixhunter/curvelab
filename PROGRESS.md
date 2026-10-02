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
- Free preset catalog with three starter experiments: graduation timing,
  curve-length comparison, and fee sensitivity.
- Save complete comparisons to browser storage, load exact settings, fork
  independent copies with source attribution, search, and filter.
- Versioned JSON export/import includes demand, curve settings, description,
  and intended use. Imported files are bounded and validated. Missing launch
  histories block loading without substituting synthetic demand.
- Saving waits for a successful simulation of the current inputs. Corrupt or
  unavailable storage is reported without overwriting it; file export still
  works. Existing presets persist through refresh and update across tabs.
- README includes the preset format, local-storage boundaries, and demo flow.

## Validation

- 88 tests passed across 10 files. Preset round trips reproduce synthetic and
  mainnet outcomes, including baseline results and creator fee shares.
- Typecheck, ESLint, and Next.js production build passed.
- Browser interaction checks covered chart switching, adding/removing curves,
  minimum curve length, all synthetic shapes, and maximum demand.
- No page overflow at 360, 420, 768, or 1440 pixels. No browser runtime errors.
- Preset browser checks cover save, reload persistence, exact request restore,
  fork edits, export/download, import into a clean browser, cross-tab updates,
  search, malformed and duplicate imports, missing launches, corrupt storage,
  and long names/labels. Scratch verification: `_preset_check.py`.
- Rechecked after the handoff: 88 tests, typecheck, ESLint, production build,
  and the preset browser checks pass. Independent pre-commit review found no
  security concerns or reproducible logic errors in the milestone.

## Running locally

- Development UI: http://localhost:3000
- Capture command: `npm run capture -- --target 10 --sample 120 --max-pages 30 --rounds 12 --cooldown 90`.
- A single guarded collector restarted successfully at 2026-10-02 00:41 UTC.
  Its process environment pins the free public Solana endpoint explicitly.
  Progress and the current owner PID are in `data/capture.log` and
  `data/capture.lock`. The earlier restart rejection did not recur.
- The capture target is ten accepted histories, not a promise of ten UI-eligible
  comparisons. Public RPC throttling still limits collection speed.
- Three old overlapping collectors were stopped before starting the guarded run.

## Remaining product work

1. Collect a broader set of UI-eligible mainnet launch histories. The collector
   is running; still three stored histories, one UI-eligible at this checkpoint.
2. Submission framing and demo. Recheck official terms before submission.
3. Shared or paid marketplace distribution is future work. The current free
   catalog is local to the browser, with portable files for sharing.

## Working tree notes

The narrower simulator sidebar breakpoint in `CurveLab.tsx` and the untracked
`src/app/api/health/route.ts` existed before this preset work and were preserved.
No deployment or paid service was used. The reviewed milestone is ready for
the local preset-catalog commit; demo materials follow in a separate change.

## Model boundaries

This milestone models the DBC phase and holds buys fixed across curves. It does
not predict trader behavior, model post-migration DAMM fees, implement dynamic
fee state, or execute transactions. Fee values combine partner and creator
shares; base-token fees are valued in SOL at each trade's execution rate.
