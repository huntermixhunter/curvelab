import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getPriceFromSqrtPrice } from '@meteora-ag/dynamic-bonding-curve-sdk'
import BN from 'bn.js'
import type { PoolHistory } from '../chain/backfill'
// Declared in the wire types rather than here: the browser needs these shapes,
// and importing them from a module that opens `node:fs` would drag the server's
// filesystem access into the client graph.
import type { PoolSummary, RealCurveShape } from '../api/types'
import { SIMULATION_LIMITS as LIMITS } from '../api/limits'
import { decodeStoredConfig } from '../dbc/replay'

/**
 * The corpus of real mainnet launches available to replay against.
 *
 * Fixtures are large (a 500-swap launch is ~250 KB of JSON) and there is no
 * reason for a browser to ever hold one: the simulation runs on the server, so
 * only the summary and the resulting series cross the wire.
 */
const POOL_DIR = join(process.cwd(), 'data', 'pools')

/** Parsed fixtures, keyed by pool address. Invalidated by file mtime. */
const cache = new Map<string, { mtimeMs: number; history: PoolHistory }>()

/**
 * The directory is re-read at most this often. Capture runs as a background
 * job, so new pools land while the server is up and should appear without a
 * restart; re-reading on literally every request is the only other option and
 * costs a syscall per hit for no benefit.
 */
const LISTING_TTL_MS = 5_000
let listing: { at: number; files: string[] } | null = null

function poolFiles(): string[] {
  const now = Date.now()
  if (listing && now - listing.at < LISTING_TTL_MS) return listing.files
  const files = existsSync(POOL_DIR)
    ? readdirSync(POOL_DIR).filter((f) => f.endsWith('.json')).sort()
    : []
  listing = { at: now, files }
  return files
}

export function loadPool(address: string): PoolHistory | null {
  // Guard against path traversal: an address is a base58 key, nothing else.
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return null

  const path = join(POOL_DIR, `${address}.json`)
  if (!existsSync(path)) return null

  const { mtimeMs } = statSync(path)
  const hit = cache.get(address)
  if (hit && hit.mtimeMs === mtimeMs) return hit.history

  const history = JSON.parse(readFileSync(path, 'utf8')) as PoolHistory
  cache.set(address, { mtimeMs, history })
  return history
}

/**
 * Recover the high-level curve shape from an on-chain config.
 *
 * This is what makes a real launch a starting point rather than just a demand
 * source: the same four numbers the designer edits, read back off a pool that
 * already happened, so a counterfactual can begin from "what they actually did"
 * and change one thing.
 */
export function realCurveShape(h: PoolHistory): RealCurveShape {
  const priceAt = (sqrtPrice: string) =>
    Number(
      getPriceFromSqrtPrice(new BN(sqrtPrice), h.tokenBaseDecimal, h.tokenQuoteDecimal).toString(),
    )
  const initialMarketCap = priceAt(h.sqrtStartPrice) * h.totalTokenSupplyUi
  const migrationMarketCap = priceAt(h.migrationSqrtPrice) * h.totalTokenSupplyUi

  return {
    initialMarketCap,
    migrationMarketCap,
    curveLength: initialMarketCap > 0 ? migrationMarketCap / initialMarketCap : 1,
    baseFeeBps: h.baseFeeBps,
    creatorTradingFeePercentage: h.creatorTradingFeePercentage,
    totalTokenSupply: h.totalTokenSupplyUi,
    migrationThresholdQuote: Number(h.migrationQuoteThreshold) / 10 ** h.tokenQuoteDecimal,
  }
}

export function summarise(h: PoolHistory): PoolSummary {
  const scale = 10 ** h.tokenQuoteDecimal
  const buyDemandQuote =
    h.trades.filter((t) => t.side === 'buy').reduce((s, t) => s + Number(t.amountIn), 0) / scale

  return {
    pool: h.pool,
    baseMint: h.baseMint,
    buys: h.stats.buys,
    sells: h.stats.sells,
    swaps: h.stats.swaps,
    buyDemandQuote,
    graduated: h.isMigrated || h.stats.graduatedAtTrade !== null,
    graduatedAtTrade: h.stats.graduatedAtTrade,
    lifetimeSeconds: h.stats.lifetimeSeconds,
    failedTransactions: h.stats.failedTransactions,
    fetchedAt: h.fetchedAt,
    curve: realCurveShape(h),
    verifiedComplete: h.integrity?.continuous === true,
  }
}

/** Preserve unsupported fixtures for verification without offering broken comparisons. */
export function comparisonIssue(h: PoolHistory): string | null {
  if (h.integrity?.continuous !== true) return 'This pool has an incomplete trade history.'
  if (h.quoteMint !== 'So11111111111111111111111111111111111111112') {
    return 'The comparison currently supports SOL-quoted pools only.'
  }
  const buys = h.trades.filter((t) => t.side === 'buy').length
  if (buys < 1 || buys > LIMITS.buys.max) return 'This pool exceeds the supported buy-order count.'
  const shape = realCurveShape(h)
  const inRange = (v: number, range: { min: number; max: number }) =>
    Number.isFinite(v) && v >= range.min && v <= range.max
  if (!inRange(shape.curveLength, LIMITS.curveLength) ||
      !inRange(shape.migrationThresholdQuote / 2, LIMITS.threshold) ||
      !inRange(shape.migrationThresholdQuote * 2, LIMITS.threshold) ||
      !inRange(shape.totalTokenSupply, LIMITS.supply) ||
      !inRange(shape.baseFeeBps, LIMITS.baseFeeBps)) {
    return 'This pool is outside the curve designer\'s supported parameter range.'
  }
  const config = decodeStoredConfig(h)
  if (config.poolFees.dynamicFee?.initialized) {
    return 'Dynamic-fee counterfactuals are not supported yet.'
  }
  return null
}

/**
 * Every usable pool in the corpus, most trades first.
 *
 * A fixture whose reserve chain has a gap is excluded rather than flagged. It
 * is missing trades, so any counterfactual built on it compares a designed
 * curve against a launch that never happened, and no caveat in the UI makes
 * that number mean anything.
 */
export function listPools(): PoolSummary[] {
  return poolFiles()
    .map((f) => loadPool(f.replace(/\.json$/, '')))
    .filter((h): h is PoolHistory => h !== null && comparisonIssue(h) === null)
    .map(summarise)
    .sort((a, b) => b.swaps - a.swaps)
}
