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
- Preset milestone committed as `57fd985` after independent review.
- Local submission kit: `docs/DEMO.md`, `docs/SUBMISSION.md`, and a six-slide
  HTML/PDF deck at `/demo/pitch.html` and `/demo/pitch.pdf` on the dev server.
- `npm run demo:evidence` verifies every stored fixture offline, records file
  hashes and measured results, and exports the real-launch demo plus all three
  synthetic starter presets to `docs/demo/`.
- Demo copy distinguishes the original config from rebuilt alternatives, whose
  standard allocation settings do not preserve source vesting/liquidity splits.
- Public source release: https://github.com/huntermixhunter/curvelab
- Release branch is `main`, fast-forwarded from the reviewed
  `mainnet-verification` milestone. MIT license and fresh-clone instructions
  are included with the source, fixtures, portable presets, and demo deck.
- Public application deployed October 1, 2026 Pacific with approval:
  https://curvelab-lake.vercel.app
- Public deck: https://curvelab-lake.vercel.app/demo/pitch.html
- Public PDF: https://curvelab-lake.vercel.app/demo/pitch.pdf
- Vercel project `curvelab`, team `huntermixhunters-projects`, active Hobby
  plan. GitHub `main` is connected for automatic production deployments.
  Project ID: `prj_cCgonCEMNnN0AdXW6mmLnkXkncc4`.
- First deployment used a clean archive of source commit `5276905`, excluding
  local scratch files. No domain purchase or paid service was used.

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
- New evidence command and standalone replay check pass: three fixtures,
  493 exact swaps, one UI-eligible history in the recorded demo snapshot.
- Deck checked at desktop and mobile widths, with keyboard navigation and no
  browser errors. PDF has six pages with no content overflow or missing image.
- Independent review also approved the demo generator and submission kit with
  no security concerns or reproducible logic errors.
- Public-release checks passed: 88 tests, typecheck, ESLint, production build,
  and whitespace validation. A targeted credential scan covered all 111
  historical file blobs before the release-doc commit, with no matches.
  The six-page PDF text, metadata, and published screenshot were also reviewed.
- Hosting checks: fresh local and Vercel production builds passed. All three
  fixtures are present in the page, pool-list, and simulation server traces.
  Anonymous requests return 200 for the app, health, pool list, HTML deck,
  and PDF deck. All four portable demo inputs simulate successfully; mainnet
  metrics match the stored evidence and demand accounting balances.
- Public browser checks pass for mainnet loading, save/reload persistence,
  fork, JSON export/import, restored inputs, all three synthetic starters,
  chart switching, and 390/1440-pixel layouts, with no runtime errors.
  Scratch verifier: `_deployment_check.py`. CDP needs focus emulation when
  Chrome is hidden so ResizeObserver callbacks run during viewport checks.

## Running locally

- Development UI: http://localhost:3000
- Capture command: `npm run capture -- --target 10 --sample 120 --max-pages 30 --rounds 12 --cooldown 90`.
- A single guarded collector restarted successfully at 2026-10-02 00:41 UTC.
  Its process environment pins the free public Solana endpoint explicitly.
  Progress and the current owner PID are in `data/capture.log` and
  `data/capture.lock`. The earlier restart rejection did not recur.
- At 00:52 UTC the collector owner is PID 12196 and the first new candidate's
  backfill is at 224/327 transaction reads. New captures are not yet claimed as
  accepted. Check the log and process before starting any additional job.
- The capture target is ten accepted histories, not a promise of ten UI-eligible
  comparisons. Public RPC throttling still limits collection speed.
- Three old overlapping collectors were stopped before starting the guarded run.

## Submission status: SENT

Submitted to the Meteora DBC bounty on Superteam Earn, October 1, 2026 Pacific.
The listing shows "Edit Submission" and the count moved 18 to 19, so the entry
is recorded. It remains editable until the deadline, October 12, 2026 at
11:59 PM Pacific.

- Listing: https://earn.superteam.fun/listing/meteora-dbc/
- Submitted under a new Superteam Earn talent profile: @huntermixhunter,
  signed in with Google as hunterthomasmix@gmail.com. Skills: Blockchain,
  Frontend, Typescript. Social: github.com/huntermixhunter.
- Submitted values: link and website https://curvelab-lake.vercel.app ;
  GitHub https://github.com/huntermixhunter/curvelab ; deck
  https://curvelab-lake.vercel.app/demo/pitch.pdf ; Colosseum question
  answered **No**; tweet, Project X, and both Colosseum links left blank.
- Colosseum is deliberately out of scope. Meteora bounty only, so its separate
  presentation and demo videos are not required.
- Open item: prize payout would land on the Privy wallet tied to that Earn
  account, which currently holds $0 and has not been linked to a wallet the
  Captain controls. Worth confirming before any award.

## Pre-submission corrections

Independent review (Riker) confirmed the mainnet verification is genuine, not
circular: fixture expectations are decoded from the DBC program's own EvtSwap2
events, the engine only ever receives amountIn, and a deliberate one-lamport
perturbation of the math drops the match from 491/491 to 0/491. Three claims
were corrected before sending:

1. The deck headline read "493 / 493 across 3 verified histories", which reads
   as three full launches. It is one 491-swap reference launch plus two
   single-swap fixtures outside the designer's range. The slide now reports
   491/491 and footnotes the rest, matching the README.
2. The deck also now discloses that fixtures are admitted only when they
   already replay exactly, so the match rate reflects the admission gate.
3. README: "reproduces any target" narrowed to the tested 1 to 3,000 SOL range;
   "proves its data is complete" softened to "checks".

Two publication defects were also fixed:

- The deck carried no live or source address and still called itself a
  "working local prototype". It now leads with both URLs.
- `docs/demo/evidence.json` published fixture hashes that only reproduced on
  Linux and macOS. With core.autocrlf the repository stored LF but a Windows
  clone checked out CRLF, so the same commit hashed differently per platform.
  `.gitattributes` now marks the fixtures -text, and the evidence was
  regenerated from a clean tree (sourceDirty is now false).

## Remaining product work

1. Collect a broader set of UI-eligible mainnet launch histories. Still three
   stored histories, one UI-eligible at this checkpoint.
2. Outreach to five launchpad builders has not been sent.
3. Shared or paid marketplace distribution is future work. The current free
   catalog is local to the browser, with portable files for sharing.
4. No video is recorded. The Superteam listing accepts a deck, which is what
   was submitted.

## Working tree notes

The narrower simulator sidebar breakpoint in `CurveLab.tsx` and the untracked
`src/app/api/health/route.ts` existed before this preset work and were preserved.
The application is now deployed on Vercel's free Hobby plan. The preset
milestone and demo kit are committed in separate reviewed commits. The release
branch is `main`; pushes trigger production deployments.
The `origin` remote is https://github.com/huntermixhunter/curvelab.git
The earlier `mainnet-verification` branch remains available locally.
The public server uses the fixture snapshot shipped with each deployment.
Capture remains a separate local process. Browser presets from localhost need
JSON export/import to appear on the public origin.

## Model boundaries

This milestone models the DBC phase and holds buys fixed across curves. It does
not predict trader behavior, model post-migration DAMM fees, implement dynamic
fee state, or execute transactions. Fee values combine partner and creator
shares; base-token fees are valued in SOL at each trade's execution rate.
