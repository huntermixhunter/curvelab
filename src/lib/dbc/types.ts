import type BN from 'bn.js'

/**
 * A single trade in a simulated buy/sell flow.
 * `quoteIn` is in quote lamports (e.g. SOL * 1e9) for buys.
 * `baseIn` is in base lamports for sells.
 */
export type SimTrade =
  | { side: 'buy'; quoteIn: BN; atSlot?: number }
  | { side: 'sell'; baseIn: BN; atSlot?: number }

/** State of the virtual pool after a single step. */
export interface SimStep {
  index: number
  side: 'buy' | 'sell'
  /** Amount supplied by the trader, in lamports of the input token. */
  amountIn: BN
  /** Amount received by the trader, in lamports of the output token. */
  amountOut: BN
  /** Input the pool could not fill (partial-fill / post-graduation). */
  amountLeft: BN
  sqrtPriceAfter: BN
  baseReserve: BN
  quoteReserve: BN
  /** Fee accruing to partner + creator, in the fee-collection token. */
  tradingFee: BN
  /** Fee accruing to the Meteora protocol. */
  protocolFee: BN
  /** Spot price (quote per base, decimal-adjusted) after this trade. */
  priceAfter: number
  /** Fully diluted market cap in quote units after this trade. */
  marketCapAfter: number
  /** True once cumulative quote reserve has reached the migration threshold. */
  graduated: boolean
}

export interface SimResult {
  steps: SimStep[]
  /** 1-based index of the trade that crossed the migration threshold, else null. */
  graduatedAtTrade: number | null
  /** Total quote volume routed through the curve, in lamports. */
  totalQuoteVolume: BN
  /** Cumulative partner + creator fees, in lamports. */
  totalTradingFee: BN
  /** Cumulative Meteora protocol fees, in lamports. */
  totalProtocolFee: BN
  /** Base tokens sold out of the curve, in lamports. */
  totalBaseSold: BN
  finalPrice: number
  finalMarketCap: number
  /** Quote lamports still required to graduate; zero once graduated. */
  quoteToGraduate: BN
  /**
   * Trades that arrived after the curve graduated and so were never routed
   * through it. On a real launch this demand lands in the DAMM v2 pool instead.
   * A high count means the curve graduated early and left demand on the table.
   */
  tradesAfterGraduation: number
  /** Quote lamports of buy demand that arrived after graduation. */
  quoteDemandAfterGraduation: BN
}
