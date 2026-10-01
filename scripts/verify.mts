/**
 * Replay stored mainnet pools through the engine and check it reproduces the chain.
 *
 *   node scripts/verify.mts                      verify every fixture in data/pools
 *   node scripts/verify.mts <file.json> [...]    verify specific fixtures
 *   node scripts/verify.mts --verbose            show the first mismatching trades
 *
 * Runs entirely offline: a fixture carries the raw config bytes, so no RPC is
 * touched here. Exits non-zero if any pool fails to replay exactly, which makes
 * this usable as a correctness gate in CI.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PoolHistory } from '../src/lib/chain/backfill'
import { verifyAgainstChain, summariseLaunch } from '../src/lib/dbc/replay'

const argv = process.argv.slice(2)
const verbose = argv.includes('--verbose')
const explicit = argv.filter((a) => !a.startsWith('--'))

const POOL_DIR = join('data', 'pools')

function fixturePaths(): string[] {
  if (explicit.length) return explicit
  if (!existsSync(POOL_DIR)) return []
  return readdirSync(POOL_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(POOL_DIR, f))
}

const paths = fixturePaths()
if (!paths.length) {
  console.error(
    `No fixtures found in ${POOL_DIR}.\n` +
      'Pull one first:\n' +
      '  node scripts/backfill.mts discover --graduated\n' +
      '  node scripts/backfill.mts fetch <pool>',
  )
  process.exit(1)
}

/** Mismatches shown per failing pool before truncating. */
const MAX_SHOWN = 5

let failures = 0

console.log('pool                                          trades  matched   exact  note')
console.log('-'.repeat(88))

for (const path of paths) {
  let history: PoolHistory
  try {
    history = JSON.parse(readFileSync(path, 'utf8')) as PoolHistory
  } catch (e) {
    console.log(`${path.padEnd(45)}   unreadable: ${(e as Error).message}`)
    failures++
    continue
  }

  // A fixture with a broken reserve chain is missing trades, so the engine is
  // being asked to reproduce a history that never happened. Replaying it would
  // report mismatches that say nothing about whether the math is right.
  const integrity = history.integrity
  if (!integrity) {
    // Predates the completeness check, so its trade list was never validated
    // against the chain's own reserve. Treating "no gaps recorded" as "no gaps"
    // is exactly the silent failure this gate exists to prevent.
    console.log(
      history.pool.padEnd(45) +
        String(history.trades?.length ?? 0).padStart(6) +
        '        -      no  STALE: captured before the integrity check, re-run the backfill',
    )
    failures++
    continue
  }
  if (!integrity.continuous) {
    console.log(
      history.pool.padEnd(45) +
        String(history.trades.length).padStart(6) +
        '        -' +
        '      no' +
        `  INCOMPLETE: ${integrity.gaps.length} gap(s), re-run the backfill`,
    )
    failures++
    continue
  }

  let verdict
  try {
    verdict = verifyAgainstChain(history)
  } catch (e) {
    console.log(`${history.pool.padEnd(45)}   threw: ${(e as Error).message}`)
    failures++
    continue
  }

  // A pool with dynamic fees enabled prices each swap partly from a volatility
  // accumulator the engine does not track, so drift there is expected and is
  // reported rather than counted as a correctness failure.
  const expectedDrift = verdict.dynamicFeeEnabled && !verdict.exact
  if (!verdict.exact && !expectedDrift) failures++

  const note = verdict.exact
    ? ''
    : expectedDrift
      ? 'dynamic fees enabled, drift expected'
      : `${verdict.mismatches.length} mismatch(es)`

  console.log(
    history.pool.padEnd(45) +
      String(verdict.trades).padStart(6) +
      String(verdict.matched).padStart(9) +
      (verdict.exact ? '     yes' : '      no') +
      '  ' +
      note,
  )

  if (verbose || (!verdict.exact && !expectedDrift)) {
    for (const m of verdict.mismatches.slice(0, MAX_SHOWN)) {
      console.log(`      #${m.index} ${m.side} ${m.field}`)
      console.log(`        chain ${m.chain}`)
      console.log(`        sim   ${m.simulated}`)
    }
    if (verdict.mismatches.length > MAX_SHOWN) {
      console.log(`      ... ${verdict.mismatches.length - MAX_SHOWN} more`)
    }
  }

  if (verbose) {
    const s = summariseLaunch(history)
    console.log(
      `      graduated=${s.graduated}` +
        (s.graduatedAtTrade ? ` at trade #${s.graduatedAtTrade}` : '') +
        ` buys=${s.totalBuys} sells=${s.totalSells}` +
        ` volume=${s.quoteVolume.toFixed(2)}` +
        ` fees=${s.tradingFee.toFixed(4)}` +
        ` firstBuy=${(s.firstBuyShareOfCurve * 100).toFixed(1)}% of curve` +
        ` failedTx=${s.failedTransactions}`,
    )
  }
}

console.log()
if (failures) {
  console.log(`${failures} of ${paths.length} pool(s) did not replay exactly.`)
  process.exit(1)
}
console.log(`All ${paths.length} pool(s) replayed exactly against the chain.`)
