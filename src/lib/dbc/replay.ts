import BN from 'bn.js'
import type { PoolConfig } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { decodeConfigBase64, decodePoolBase64, type DbcPoolState } from '../chain/accounts'
import type { PoolHistory, RealTrade } from '../chain/backfill'
import { simulate } from './simulate'
import type { SimTrade, SimResult } from './types'

/** Activation points are slots when `activationType` is 0, timestamps when 1. */
const ACTIVATION_TYPE_SLOT = 0

/**
 * Rebuild the exact on-chain config from a stored fixture.
 *
 * The fixture keeps the raw account bytes rather than a field-by-field JSON
 * copy, so this returns precisely what the chain held: a 20-element curve
 * array, u128 sqrt prices, and the full fee configuration, with no lossy trip
 * through JSON numbers.
 */
export function decodeStoredConfig(history: PoolHistory): PoolConfig {
  const decoded = decodeConfigBase64(history.configAccountBase64)
  if (!decoded) throw new Error(`fixture ${history.pool}: config bytes did not decode`)
  return decoded.config
}

/**
 * The pool state as it stood when the fixture was captured.
 *
 * Decoding goes through `accounts.ts` rather than naming `virtualPool`
 * directly: a Token-2022 launch is stored under a different discriminator, and
 * hardcoding the plain variant would throw on every one of them. This returns
 * the inner `poolState`, which is where the pool's real fields live.
 */
export function decodeStoredPool(history: PoolHistory): DbcPoolState {
  const decoded = decodePoolBase64(history.poolAccountBase64)
  if (!decoded) throw new Error(`fixture ${history.pool}: pool bytes did not decode`)
  return decoded.state
}

export interface ToSimTradesOptions {
  /**
   * Drop sells and keep only the buy flow.
   *
   * Required for a counterfactual. A sell is denominated in base tokens, and
   * the number of base tokens a trader holds depends on the curve they bought
   * on, so a real sell amount is not meaningful against a different curve. Buy
   * demand is denominated in SOL and does transfer.
   */
  buysOnly?: boolean
}

/**
 * Convert a real pool history into engine input.
 *
 * `amountIn` is used rather than `amountFilled`: it is what the trader actually
 * submitted, and the engine decides for itself how much the curve can absorb.
 * Feeding it the already-truncated amount would hide partial fills, which are
 * one of the behaviours the engine exists to model.
 */
export function toSimTrades(
  history: PoolHistory,
  opts: ToSimTradesOptions = {},
): SimTrade[] {
  const config = decodeStoredConfig(history)
  const useSlot = Number(config.activationType) === ACTIVATION_TYPE_SLOT

  const trades = opts.buysOnly
    ? history.trades.filter((t) => t.side === 'buy')
    : history.trades

  return trades.map((t) => currentPointOf(t, useSlot))
}

function currentPointOf(t: RealTrade, useSlot: boolean): SimTrade {
  const atSlot = useSlot ? t.slot : (t.blockTime ?? 0)
  return t.side === 'buy'
    ? { side: 'buy', quoteIn: new BN(t.amountIn), atSlot }
    : { side: 'sell', baseIn: new BN(t.amountIn), atSlot }
}

export interface TradeCheck {
  index: number
  signature: string
  side: 'buy' | 'sell'
  field: 'nextSqrtPrice' | 'quoteReserve' | 'amountOut'
  chain: string
  simulated: string
}

export interface VerifyResult {
  pool: string
  trades: number
  /** Trades where price, reserve, and output all matched the chain exactly. */
  matched: number
  mismatches: TradeCheck[]
  exact: boolean
  /**
   * Dynamic fees depend on a volatility accumulator the engine does not track.
   * When this is true any drift is expected rather than a correctness bug.
   */
  dynamicFeeEnabled: boolean
  result: SimResult
}

/**
 * Replay a real pool against its own config and check the engine reproduces
 * the chain.
 *
 * This is the measurement that makes every other output trustworthy. The
 * program recorded `nextSqrtPrice` and `quoteReserve` after each swap; the
 * engine recomputes both from the curve alone. If they agree on every trade of
 * a real launch, then a price path for a curve that does not exist yet is
 * being produced by the same arithmetic that produced the real one.
 */
export function verifyAgainstChain(history: PoolHistory): VerifyResult {
  const config = decodeStoredConfig(history)
  const poolState = decodeStoredPool(history)

  const result = simulate({
    config,
    trades: toSimTrades(history),
    tokenBaseDecimal: history.tokenBaseDecimal,
    tokenQuoteDecimal: history.tokenQuoteDecimal,
    totalTokenSupply: history.totalTokenSupplyUi,
    activationPoint: poolState.activationPoint,
  })

  const mismatches: TradeCheck[] = []
  let matched = 0

  for (let i = 0; i < result.steps.length && i < history.trades.length; i++) {
    const step = result.steps[i]
    const real = history.trades[i]
    const before = mismatches.length

    const compare = (field: TradeCheck['field'], chain: string, simulated: string) => {
      if (chain !== simulated) {
        mismatches.push({ index: i, signature: real.signature, side: real.side, field, chain, simulated })
      }
    }
    compare('nextSqrtPrice', real.nextSqrtPrice, step.sqrtPriceAfter.toString())
    compare('amountOut', real.amountOut, step.amountOut.toString())
    // Sells reduce the reserve, and the engine floors it at zero where the
    // program tracks it exactly, so only buys are compared on reserve.
    if (real.side === 'buy') {
      compare('quoteReserve', real.quoteReserveAfter, step.quoteReserve.toString())
    }
    if (mismatches.length === before) matched++
  }

  const dynamicFee = (config.poolFees as { dynamicFee?: { initialized?: number } }).dynamicFee
  return {
    pool: history.pool,
    trades: Math.min(result.steps.length, history.trades.length),
    matched,
    mismatches,
    exact: mismatches.length === 0 && result.steps.length === history.trades.length,
    dynamicFeeEnabled: Number(dynamicFee?.initialized ?? 0) === 1,
    result,
  }
}

/** Headline numbers from a real launch, in whole quote tokens. */
export interface RealLaunchSummary {
  pool: string
  graduated: boolean
  graduatedAtTrade: number | null
  totalBuys: number
  totalSells: number
  /** Buy demand routed through the curve. */
  quoteVolume: number
  /** The creator plus partner share of trading fees. */
  tradingFee: number
  /** Share of all curve capacity taken by the very first buy. */
  firstBuyShareOfCurve: number
  lifetimeSeconds: number | null
  failedTransactions: number
}

export function summariseLaunch(history: PoolHistory): RealLaunchSummary {
  const scale = 10 ** history.tokenQuoteDecimal
  const threshold = Number(history.migrationQuoteThreshold)
  const firstBuy = history.trades.find((t) => t.side === 'buy')

  const quoteVolume = history.trades
    .filter((t) => t.side === 'buy')
    .reduce((sum, t) => sum + Number(t.amountFilled), 0)

  // Trading fees are collected in the output token when collectFeeMode is 1,
  // so only quote-denominated fees are summed here to avoid adding SOL to
  // base-token units.
  const tradingFee = history.trades
    .filter((t) => (history.collectFeeMode === 0 ? true : t.side === 'sell'))
    .reduce((sum, t) => sum + Number(t.tradingFee), 0)

  return {
    pool: history.pool,
    graduated: history.isMigrated || history.stats.graduatedAtTrade !== null,
    graduatedAtTrade: history.stats.graduatedAtTrade,
    totalBuys: history.stats.buys,
    totalSells: history.stats.sells,
    quoteVolume: quoteVolume / scale,
    tradingFee: tradingFee / scale,
    firstBuyShareOfCurve: firstBuy && threshold > 0 ? Number(firstBuy.amountFilled) / threshold : 0,
    lifetimeSeconds: history.stats.lifetimeSeconds,
    failedTransactions: history.stats.failedTransactions,
  }
}
