import type { DemandShape } from '../dbc/demand'

/**
 * Wire types shared by the browser and the route handlers.
 *
 * Deliberately free of `BN` and of anything that imports the SDK: this module
 * is pulled into the client bundle, and the whole point of running the engine
 * server-side is that neither the SDK nor a 250 KB fixture needs to ship to a
 * browser. Every amount here is a plain number in whole quote tokens.
 */

/**
 * The numbers a curve designer actually turns.
 *
 * Deliberately not the SDK's two market caps. The threshold a pair of market
 * caps implies depends on how much base supply the curve sells, so the same
 * caps mean 11 SOL on one pool and 187 on another, and market caps do not
 * compare across tokens at all. These two do: how much SOL it takes to
 * graduate, and how far the price runs getting there.
 */
export interface CurveInput {
  /** Quote tokens required to graduate. */
  migrationThresholdQuote: number
  /** Migration market cap divided by start market cap. Always above 1. */
  curveLength: number
  baseFeeBps: number
  creatorTradingFeePercentage: number
  totalTokenSupply: number
}

export interface CurveRequest {
  /** Stable across edits. Colour follows this, never the array position. */
  id: string
  label: string
  /** Categorical palette slot, 0-2. Held by the curve, not recomputed on filter. */
  slot: number
  curve: CurveInput
}

export type DemandRequest =
  | { kind: 'synthetic'; shape: DemandShape; buys: number; totalQuote: number }
  | { kind: 'pool'; pool: string }

export interface SimulateRequest {
  curves: CurveRequest[]
  demand: DemandRequest
}

/** One point on a curve's path. Downsampled for the chart; metrics are exact. */
export interface SeriesPoint {
  /** 1-based trade index. */
  t: number
  marketCap: number
  price: number
  /** Quote reserve accumulated toward the migration threshold. */
  reserve: number
  /** Cumulative creator + partner fee up to and including this trade. */
  fee: number
}

export interface CurveOutcome {
  id: string
  label: string
  slot: number
  curve: CurveInput
  /** Quote tokens required to graduate, read back off the built config. */
  migrationThresholdQuote: number
  /** Market cap the curve starts at, solved from the threshold and length. */
  initialMarketCap: number
  /** Market cap at which it graduates. */
  migrationMarketCap: number
  graduatedAtTrade: number | null
  /** Trades the curve actually priced, before it stopped accepting them. */
  tradesThroughCurve: number
  /** Quote that reached the curve, in whole tokens. */
  quoteThroughCurve: number
  /**
   * Buy demand that arrived after graduation and never touched the curve. On a
   * real launch this routes to the migrated DAMM v2 pool instead.
   */
  quoteStranded: number
  /** Quote returned unfilled on a buy that reached the migration target. */
  quoteUnfilled: number
  /** Partner + creator fee, in whole quote tokens. */
  tradingFee: number
  protocolFee: number
  finalMarketCap: number
  /** Still needed to graduate. Zero once graduated. */
  quoteToGraduate: number
  series: SeriesPoint[]
  /** Set when this curve could not be built or priced at all. */
  error?: string
}

/** The launch that actually happened, replayed on the same buy-only flow. */
export interface Baseline extends CurveOutcome {
  pool: string
  /** What the chain itself recorded, including the sells a counterfactual drops. */
  onChain: {
    graduatedAtTrade: number | null
    buys: number
    sells: number
    lifetimeSeconds: number | null
    failedTransactions: number
  }
}

export interface DemandSummary {
  kind: 'synthetic' | 'pool'
  label: string
  /** Buy orders in the flow. */
  buys: number
  /** Total quote submitted across every buy, in whole tokens. */
  totalQuote: number
  /** Largest single buy as a share of the total, 0-1. */
  largestBuyShare: number
  source?: string
}

export interface SimulateResponse {
  demand: DemandSummary
  curves: CurveOutcome[]
  baseline?: Baseline
  /** Wall-clock milliseconds spent in the engine. */
  elapsedMs: number
}

/** The curve a real pool actually launched on, in the designer's own units. */
export interface RealCurveShape {
  initialMarketCap: number
  migrationMarketCap: number
  /** Migration market cap divided by start market cap. */
  curveLength: number
  baseFeeBps: number
  creatorTradingFeePercentage: number
  totalTokenSupply: number
  /** Quote tokens required to graduate, in whole units. */
  migrationThresholdQuote: number
}

/** A verified mainnet launch, as offered to the browser's pool picker. */
export interface PoolSummary {
  pool: string
  baseMint: string
  /** Buys only: the part of the flow a counterfactual can replay. */
  buys: number
  sells: number
  swaps: number
  /** Total buy demand submitted, in whole quote tokens. */
  buyDemandQuote: number
  graduated: boolean
  graduatedAtTrade: number | null
  lifetimeSeconds: number | null
  failedTransactions: number
  fetchedAt: string
  curve: RealCurveShape
  /** Proven complete: every trade's effect lands on the next trade's reserve. */
  verifiedComplete: boolean
}
