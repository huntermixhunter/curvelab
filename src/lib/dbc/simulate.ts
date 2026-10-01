import BN from 'bn.js'
import {
  swapQuoteExactIn,
  swapQuotePartialFill,
  getMigrationThresholdPrice,
  getPriceFromSqrtPrice,
  type ConfigParameters,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import type { SimTrade, SimStep, SimResult } from './types'

/**
 * Reconcile a `buildCurve*` output into something the quote math accepts.
 *
 * This mirrors the SDK's own `PoolService.normalizeQuoteConfig`, which is private
 * and therefore not importable. Two fields differ between an on-chain `PoolConfig`
 * and a freshly built `ConfigParameters`:
 *
 *  - `migrationSqrtPrice` is absent and must be derived; it is the swap stop price.
 *  - `poolFees.dynamicFee` is `null`, which makes `isDynamicFeeEnabled` throw.
 *
 * Keep this in sync with the SDK if the DBC version is bumped.
 */
export function normalizeQuoteConfig(config: ConfigParameters) {
  if (!config.curve || config.curve.length === 0) {
    throw new Error('normalizeQuoteConfig: config.curve is empty')
  }
  const migrationSqrtPrice =
    (config as { migrationSqrtPrice?: BN }).migrationSqrtPrice ??
    getMigrationThresholdPrice(
      config.migrationQuoteThreshold,
      config.sqrtStartPrice,
      config.curve,
    )

  const dynamicFee = config.poolFees.dynamicFee as
    | (NonNullable<typeof config.poolFees.dynamicFee> & { initialized?: number })
    | null
    | undefined

  return {
    ...config,
    migrationSqrtPrice,
    poolFees: {
      ...config.poolFees,
      dynamicFee: dynamicFee
        ? { ...dynamicFee, initialized: dynamicFee.initialized ?? 1 }
        : { initialized: 0, binStep: 0, variableFeeControl: 0 },
    },
  }
}

/**
 * The subset of a `VirtualPool` the quote math actually reads.
 *
 * The SDK's `VirtualPool` type mirrors the full on-chain account (30+ fields:
 * mints, vaults, authorities, padding). None of that exists before a pool is
 * deployed, and `swapQuoteExactIn` touches only the fields below. We model
 * just those and cast at the call site.
 */
export interface QuotablePool {
  poolState: {
    sqrtPrice: BN
    baseReserve: BN
    quoteReserve: BN
    activationPoint: BN
    volatilityTracker: {
      lastUpdateTimestamp: BN
      sqrtPriceReference: BN
      volatilityAccumulator: BN
      volatilityReference: BN
      padding: number[]
    }
  }
}

type QuoteArgs = Parameters<typeof swapQuotePartialFill>
type SdkVirtualPool = QuoteArgs[0]
type SdkPoolConfig = QuoteArgs[1]

/** A virtual pool at launch: start price set, reserves and volatility zeroed. */
export function launchState(sqrtStartPrice: BN): QuotablePool {
  return {
    poolState: {
      sqrtPrice: new BN(sqrtStartPrice),
      baseReserve: new BN(0),
      quoteReserve: new BN(0),
      activationPoint: new BN(0),
      volatilityTracker: {
        lastUpdateTimestamp: new BN(0),
        sqrtPriceReference: new BN(0),
        volatilityAccumulator: new BN(0),
        volatilityReference: new BN(0),
        padding: [],
      },
    },
  }
}

export interface SimulateOptions {
  config: ConfigParameters
  trades: SimTrade[]
  tokenBaseDecimal: number
  tokenQuoteDecimal: number
  /** Total token supply in whole tokens, used for market cap. */
  totalTokenSupply: number
  slippageBps?: number
  hasReferral?: boolean
}

/**
 * Replay a sequence of trades against a DBC curve, advancing pool state between
 * each one.
 *
 * The SDK's `getQuoteFromInputAmount` rebuilds a launch-state pool on every call,
 * so it can only ever price the *first* trade. To produce a price path we own the
 * pool state here and roll it forward using each quote's `nextSqrtPrice`.
 *
 * All curve and fee math is the SDK's; this function only sequences it.
 */
export function simulate(opts: SimulateOptions): SimResult {
  const {
    config, trades, tokenBaseDecimal, tokenQuoteDecimal,
    totalTokenSupply, slippageBps = 0, hasReferral = false,
  } = opts

  const poolConfig = normalizeQuoteConfig(config)
  const pool = launchState(config.sqrtStartPrice)
  const threshold = config.migrationQuoteThreshold

  const steps: SimStep[] = []
  let totalQuoteVolume = new BN(0)
  let totalTradingFee = new BN(0)
  let totalProtocolFee = new BN(0)
  let totalBaseSold = new BN(0)
  let graduatedAtTrade: number | null = null
  let tradesAfterGraduation = 0
  let quoteDemandAfterGraduation = new BN(0)

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i]

    // The DBC program refuses swaps once quoteReserve reaches the migration
    // threshold (`swapQuoteExactIn` throws "Virtual pool is completed"). The
    // curve is finished; on a real launch this demand would route to the
    // migrated DAMM v2 pool instead. Record it rather than simulating it.
    if (pool.poolState.quoteReserve.gte(threshold)) {
      tradesAfterGraduation++
      if (t.side === 'buy') {
        quoteDemandAfterGraduation = quoteDemandAfterGraduation.add(t.quoteIn)
      }
      continue
    }
    const swapBaseForQuote = t.side === 'sell'
    const amountIn = t.side === 'buy' ? t.quoteIn : t.baseIn
    const currentPoint = new BN(t.atSlot ?? 0)

    // Buys use partial-fill semantics. As the pool approaches the migration
    // threshold the curve has less quote capacity left than the trader wants to
    // spend, and `swapQuoteExactIn` throws "Insufficient Liquidity" rather than
    // filling what it can. The real program fills up to the cap and leaves the
    // rest as `amountLeft`, which is what a trader actually experiences on the
    // final buy before graduation.
    const quoteFn = swapBaseForQuote ? swapQuoteExactIn : swapQuotePartialFill
    const q = quoteFn(
      pool as unknown as SdkVirtualPool,
      poolConfig as unknown as SdkPoolConfig,
      swapBaseForQuote, amountIn,
      slippageBps, hasReferral, currentPoint, false,
    )

    // Roll pool state forward. This is the step the SDK does not do for us.
    pool.poolState.sqrtPrice = q.nextSqrtPrice
    if (t.side === 'buy') {
      const filled = amountIn.sub(q.amountLeft ?? new BN(0))
      pool.poolState.quoteReserve = pool.poolState.quoteReserve.add(filled)
      pool.poolState.baseReserve = pool.poolState.baseReserve.add(q.outputAmount)
      totalQuoteVolume = totalQuoteVolume.add(filled)
      totalBaseSold = totalBaseSold.add(q.outputAmount)
    } else {
      const filled = amountIn.sub(q.amountLeft ?? new BN(0))
      pool.poolState.baseReserve = BN.max(new BN(0), pool.poolState.baseReserve.sub(filled))
      pool.poolState.quoteReserve = BN.max(new BN(0), pool.poolState.quoteReserve.sub(q.outputAmount))
      totalQuoteVolume = totalQuoteVolume.add(q.outputAmount)
      totalBaseSold = BN.max(new BN(0), totalBaseSold.sub(filled))
    }

    totalTradingFee = totalTradingFee.add(q.tradingFee ?? new BN(0))
    totalProtocolFee = totalProtocolFee.add(q.protocolFee ?? new BN(0))

    const price = Number(
      getPriceFromSqrtPrice(pool.poolState.sqrtPrice, tokenBaseDecimal, tokenQuoteDecimal).toString(),
    )
    const graduated = pool.poolState.quoteReserve.gte(threshold)
    if (graduated && graduatedAtTrade === null) graduatedAtTrade = i + 1

    steps.push({
      index: i,
      side: t.side,
      amountIn,
      amountOut: q.outputAmount,
      amountLeft: q.amountLeft ?? new BN(0),
      sqrtPriceAfter: pool.poolState.sqrtPrice,
      baseReserve: pool.poolState.baseReserve,
      quoteReserve: pool.poolState.quoteReserve,
      tradingFee: q.tradingFee ?? new BN(0),
      protocolFee: q.protocolFee ?? new BN(0),
      priceAfter: price,
      marketCapAfter: price * totalTokenSupply,
      graduated,
    })
  }

  const finalPrice = steps.length ? steps[steps.length - 1].priceAfter : 0
  const remaining = threshold.sub(pool.poolState.quoteReserve)

  return {
    steps,
    graduatedAtTrade,
    totalQuoteVolume,
    totalTradingFee,
    totalProtocolFee,
    totalBaseSold,
    finalPrice,
    finalMarketCap: finalPrice * totalTokenSupply,
    quoteToGraduate: remaining.isNeg() ? new BN(0) : remaining,
    tradesAfterGraduation,
    quoteDemandAfterGraduation,
  }
}
