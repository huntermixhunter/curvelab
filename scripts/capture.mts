/**
 * Build a corpus of real mainnet DBC launches, unattended.
 *
 *   node scripts/capture.mts [--target 12] [--sample 800] [--max-pages 40]
 *
 * Discovery and backfill already exist as single-shot commands. This drives
 * them in a loop so a corpus can be collected while other work proceeds, and
 * it enforces the one rule that makes a corpus usable: a fixture is only
 * promoted into `data/pools` if its reserve chain is provably continuous.
 *
 * Anything with an unclosable gap is parked in `data/pools-incomplete` rather
 * than deleted. A gap is evidence about the endpoint, not a bad pool, and
 * `npm run verify` stays green because the quarantine is outside the directory
 * it scans.
 *
 * Costs nothing: the default endpoint is the free public Solana RPC, which
 * needs no key and no account.
 */
import { writeFileSync, mkdirSync, existsSync, readdirSync, appendFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { SolanaRpc } from '../src/lib/chain/rpc'
import { discoverPools, type PoolCandidate } from '../src/lib/chain/discover'
import { backfillPool } from '../src/lib/chain/backfill'
import { verifyAgainstChain } from '../src/lib/dbc/replay'
import { acquireCaptureLock } from './capture-lock'

const argv = process.argv.slice(2)
function flag(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}

const TARGET = Number(flag('target', '12'))
const SAMPLE = Number(flag('sample', '120'))
const MAX_PAGES = Number(flag('max-pages', '40'))
/** Discovery rounds to attempt before giving up on reaching the target. */
const MAX_ROUNDS = Number(flag('rounds', '6'))
/** Pause after the endpoint refuses a discovery pass, so the limit window resets. */
const COOLDOWN_MS = Number(flag('cooldown', '90')) * 1000

const GOOD_DIR = join('data', 'pools')
const QUARANTINE_DIR = join('data', 'pools-incomplete')
const LOG = join('data', 'capture.log')

mkdirSync(GOOD_DIR, { recursive: true })
mkdirSync(QUARANTINE_DIR, { recursive: true })

const releaseLock = acquireCaptureLock(join('data', 'capture.lock'))
process.once('exit', releaseLock)
process.once('SIGINT', () => process.exit(130))
process.once('SIGTERM', () => process.exit(143))

function log(line: string) {
  const stamped = `${new Date().toISOString()}  ${line}`
  console.log(stamped)
  appendFileSync(LOG, stamped + '\n')
}

/**
 * Throttled progress, because the real failure mode here is silence.
 *
 * The free endpoint rate-limits hard enough that a single discovery pass can
 * run for many minutes, and with no output there is no way to tell a slow run
 * from a wedged one. A line every few seconds costs nothing and makes the
 * difference visible.
 */
const PROGRESS_EVERY_MS = 5_000
function progressReporter() {
  let lastAt = 0
  let lastPhase = ''
  return (phase: string, done: number, total: number) => {
    const now = Date.now()
    const finished = total > 0 && done >= total
    if (phase === lastPhase && !finished && now - lastAt < PROGRESS_EVERY_MS) return
    lastAt = now
    lastPhase = phase
    const pct = total ? Math.round((done / total) * 100) : 0
    log(`    ${phase.padEnd(14)} ${done}/${total} (${pct}%)`)
  }
}

const storedPools = () =>
  new Set(
    [GOOD_DIR, QUARANTINE_DIR]
      .filter(existsSync)
      .flatMap((d) => readdirSync(d))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, '')),
  )

const countGood = () =>
  existsSync(GOOD_DIR) ? readdirSync(GOOD_DIR).filter((f) => f.endsWith('.json')).length : 0

const rpc = new SolanaRpc({ batchSize: 4, throttleMs: 1500 })
const sol = (lamports: string, decimals: number) => Number(lamports) / 10 ** decimals

/**
 * Rank candidates for how much they teach.
 *
 * A graduated pool is worth most: it contains a complete launch from start
 * price to migration, which is the only kind of history that can answer "would
 * a different curve have graduated sooner". Among the rest, prefer pools far
 * along their curve, then pools trading heavily right now.
 */
function rank(a: PoolCandidate, b: PoolCandidate): number {
  if (a.graduated !== b.graduated) return a.graduated ? -1 : 1
  if (Math.abs(a.progress - b.progress) > 0.01) return b.progress - a.progress
  return b.swapsInSample - a.swapsInSample
}

async function capture(pool: string): Promise<'good' | 'incomplete' | 'failed'> {
  const started = Date.now()
  let history
  try {
    history = await backfillPool(rpc, pool, {
      maxPages: MAX_PAGES,
      maxRepairRounds: 4,
      onProgress: progressReporter(),
    })
  } catch (e) {
    log(`  FAILED   ${pool}  ${(e as Error).message}`)
    return 'failed'
  }

  let complete = history.integrity.continuous && history.trades.length > 0
  let reason = complete ? '' : 'incomplete or empty reserve chain'
  if (complete) {
    try {
      const replay = verifyAgainstChain(history)
      complete = replay.exact && !replay.dynamicFeeEnabled
      if (!complete) reason = 'unsupported fees or replay does not match every recorded swap'
    } catch (error) {
      complete = false
      reason = `replay failed: ${(error as Error).message}`
    }
  }
  const dir = complete ? GOOD_DIR : QUARANTINE_DIR
  const destination = join(dir, `${pool}.json`)
  const temporary = `${destination}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(history, null, 2))
  renameSync(temporary, destination)

  const s = history.stats
  const took = ((Date.now() - started) / 1000).toFixed(0)
  const detail =
    `${String(s.swaps).padStart(5)} swaps  ` +
    `${s.buys}b/${s.sells}s  ` +
    `thr ${sol(history.migrationQuoteThreshold, history.tokenQuoteDecimal).toFixed(2)} SOL  ` +
    `${s.graduatedAtTrade ? `grad #${s.graduatedAtTrade}` : 'not graduated'}  ` +
    `${history.baseFeeBps}bps  ${history.curvePoints}seg  ${took}s`

  if (complete) {
    log(`  KEPT     ${pool}  ${detail}`)
    return 'good'
  }
  log(`  PARKED   ${pool}  ${detail}  (${reason})`)
  return 'incomplete'
}

log(`capture start  target=${TARGET} good  sample=${SAMPLE}  rpc=${rpc.host}`)

let round = 0
while (countGood() < TARGET && round < MAX_ROUNDS) {
  round++
  const have = storedPools()
  log(`round ${round}: discovering (have ${countGood()}/${TARGET} good, ${have.size} seen)`)

  let candidates: PoolCandidate[]
  try {
    candidates = await discoverPools(rpc, {
      sampleSize: SAMPLE,
      limit: 400,
      onProgress: progressReporter(),
    })
  } catch (e) {
    // The free endpoint rate-limits per IP across every method, so a discovery
    // pass that spends its whole budget reading transactions gets refused on
    // the account reads that follow. Retrying immediately just burns the next
    // round against the same wall; waiting lets the window reset.
    log(`  discovery failed: ${(e as Error).message} - cooling down ${COOLDOWN_MS / 1000}s`)
    await new Promise((r) => setTimeout(r, COOLDOWN_MS))
    continue
  }

  const fresh = candidates.filter((c) => !have.has(c.pool)).sort(rank)
  log(
    `  ${candidates.length} candidate(s), ${fresh.length} new ` +
      `(${fresh.filter((c) => c.graduated).length} graduated)`,
  )
  if (!fresh.length) continue

  for (const c of fresh) {
    if (countGood() >= TARGET) break
    await capture(c.pool)
  }
}

const good = countGood()
const parked = readdirSync(QUARANTINE_DIR).filter((f) => f.endsWith('.json')).length
log(`capture done  ${good} complete fixture(s) in ${GOOD_DIR}, ${parked} parked`)
if (good < TARGET) log(`  short of target ${TARGET} after ${round} round(s)`)
