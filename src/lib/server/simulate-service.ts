import BN from 'bn.js'
import { buildCurveForThreshold } from '../dbc/curve'
import { simulate } from '../dbc/simulate'
import { decodeStoredConfig, decodeStoredPool, toSimTrades } from '../dbc/replay'
import { syntheticTrades } from '../dbc/demand'
import type { SimResult, SimStep, SimTrade, QuotableConfig } from '../dbc/types'
import type { PoolHistory } from '../chain/backfill'
import { loadPool, realCurveShape, comparisonIssue } from './corpus'
import { SIMULATION_LIMITS, SimulationInputError } from '../api/limits'
import type {
  Baseline, CurveInput, CurveOutcome, CurveRequest,
  DemandSummary, SeriesPoint, SimulateRequest, SimulateResponse,
} from '../api/types'

/**
 * Quote decimals assumed for a designed curve. Every DBC pool quoted in SOL
 * uses 9; a real pool overrides this from its own config.
 */
const DEFAULT_QUOTE_DECIMAL = 9
const DEFAULT_BASE_DECIMAL = 6

/** Chart points per curve. Metrics stay exact; only the drawn path is thinned. */
const MAX_SERIES_POINTS = 400

/** Hard ceiling on simulated trades, so one huge pool cannot stall a request. */
const MAX_TRADES = SIMULATION_LIMITS.buys.max

const toWhole = (lamports: BN, decimals: number) => Number(lamports.toString()) / 10 ** decimals

/** How the pool takes its fee, which decides what token a fee is denominated in. */
const FEE_IN_OUTPUT_TOKEN = 1

/**
 * Value one trade's fee in quote tokens.
 *
 * Under `collectFeeMode` 1 the fee on a buy is taken out of the base tokens
 * being bought, so the raw figure is base lamports. Summing those alongside the
 * quote-denominated fees from sells produces a number that is not in any unit
 * at all: on the first pool captured it reported 56 SOL of fees on a pool that
 * only ever held 11 SOL.
 *
 * Rather than approximate with a spot price, this uses the trade's own
 * execution rate. The trader paid `filled` quote for `gross` base, of which
 * `fee` base was withheld, so the fee is worth `filled * fee / gross` quote at
 * exactly the price it was taken at.
 */
function feeToQuote(
  fee: BN,
  step: SimStep,
  collectFeeMode: number,
  quoteDecimal: number,
): number {
  const inBaseToken = collectFeeMode === FEE_IN_OUTPUT_TOKEN && step.side === 'buy'
  if (!inBaseToken) return toWhole(fee, quoteDecimal)

  const grossBase = step.amountOut.add(step.tradingFee).add(step.protocolFee)
  if (grossBase.isZero()) return 0

  const filledQuote = toWhole(step.amountIn.sub(step.amountLeft), quoteDecimal)
  return filledQuote * (Number(fee.toString()) / Number(grossBase.toString()))
}

/**
 * Thin a path for drawing while keeping the points that carry meaning.
 *
 * Uniform sampling alone would drop the graduation trade whenever it fell
 * between two sample points, which is the single most important point on the
 * chart: it is where the curve stops. First, last, and graduation are pinned,
 * the rest is evenly spaced.
 */
function downsample(points: SeriesPoint[], pinned: number | null): SeriesPoint[] {
  if (points.length <= MAX_SERIES_POINTS) return points

  const keep = new Set<number>([0, points.length - 1])
  if (pinned !== null) {
    const i = pinned - 1
    if (i >= 0 && i < points.length) {
      keep.add(i)
      if (i > 0) keep.add(i - 1)
    }
  }
  const stride = (points.length - 1) / (MAX_SERIES_POINTS - 1)
  for (let k = 0; k < MAX_SERIES_POINTS; k++) keep.add(Math.round(k * stride))

  return [...keep].sort((a, b) => a - b).map((i) => points[i])
}

/** Project engine output onto the wire shape, converting lamports to whole tokens. */
function toOutcome(
  req: Pick<CurveRequest, 'id' | 'label' | 'slot'> & { curve: CurveInput },
  result: SimResult,
  migrationThreshold: BN,
  quoteDecimal: number,
  collectFeeMode: number,
  /** Market-cap endpoints of the built curve, for display only. */
  derived: { initialMarketCap: number; migrationMarketCap: number },
): CurveOutcome {
  const q = (v: BN) => toWhole(v, quoteDecimal)
  const supply = req.curve.totalTokenSupply

  // Accumulated as quote-valued numbers rather than as a BN of raw fee, because
  // under fee mode 1 the per-trade figures are in two different tokens and only
  // become addable once each has been valued at its own trade's rate.
  let tradingFee = 0
  let protocolFee = 0

  const points: SeriesPoint[] = result.steps.map((s) => {
    tradingFee += feeToQuote(s.tradingFee, s, collectFeeMode, quoteDecimal)
    protocolFee += feeToQuote(s.protocolFee, s, collectFeeMode, quoteDecimal)
    return {
      t: s.index + 1,
      marketCap: s.priceAfter * supply,
      price: s.priceAfter,
      reserve: q(s.quoteReserve),
      fee: tradingFee,
    }
  })

  return {
    id: req.id,
    label: req.label,
    slot: req.slot,
    curve: req.curve,
    migrationThresholdQuote: q(migrationThreshold),
    initialMarketCap: derived.initialMarketCap,
    migrationMarketCap: derived.migrationMarketCap,
    graduatedAtTrade: result.graduatedAtTrade,
    tradesThroughCurve: result.steps.length,
    quoteThroughCurve: q(result.totalQuoteVolume),
    quoteStranded: q(result.quoteDemandAfterGraduation),
    quoteUnfilled: q(result.steps.reduce(
      (sum, step) => step.side === 'buy' ? sum.add(step.amountLeft) : sum,
      new BN(0),
    )),
    tradingFee,
    protocolFee,
    finalMarketCap: result.finalMarketCap,
    quoteToGraduate: q(result.quoteToGraduate),
    series: downsample(points, result.graduatedAtTrade),
  }
}

/**
 * The demand flow, resolved once and shared by every curve in the request.
 *
 * Building it once is not an optimisation, it is the comparison: two curves are
 * only comparable if the exact same orders hit both of them.
 */
function resolveDemand(
  req: SimulateRequest,
): {
  trades: SimTrade[]
  summary: DemandSummary
  history?: PoolHistory
  quoteDecimal: number
  baseDecimal: number
  /** Taken from the pool so a designed curve is compared on the same fee basis. */
  collectFeeMode: number
} {
  if (req.demand.kind === 'pool') {
    const history = loadPool(req.demand.pool)
    if (!history) throw new SimulationInputError(`unknown pool ${req.demand.pool}`)
    const issue = comparisonIssue(history)
    if (issue) throw new SimulationInputError(issue)

    // Buys only. A sell is denominated in base tokens, and how many base tokens
    // a holder has depends on the curve they bought on, so a real sell amount
    // carries no meaning against a different curve.
    const trades = toSimTrades(history, { buysOnly: true })
    const amounts = trades.map((t) => Number((t as { quoteIn: BN }).quoteIn.toString()))
    const total = amounts.reduce((a, b) => a + b, 0)
    const scale = 10 ** history.tokenQuoteDecimal

    return {
      trades,
      history,
      quoteDecimal: history.tokenQuoteDecimal,
      baseDecimal: history.tokenBaseDecimal,
      collectFeeMode: history.collectFeeMode,
      summary: {
        kind: 'pool',
        label: `${history.pool.slice(0, 4)}…${history.pool.slice(-4)} real buy flow`,
        buys: trades.length,
        totalQuote: total / scale,
        largestBuyShare: total ? Math.max(...amounts) / total : 0,
        source: history.pool,
      },
    }
  }

  const { shape, totalQuote } = req.demand
  const buys = Math.min(Math.max(1, Math.floor(req.demand.buys)), MAX_TRADES)
  const trades = syntheticTrades({
    shape, buys, totalQuote, tokenQuoteDecimal: DEFAULT_QUOTE_DECIMAL,
  })
  const amounts = trades.map((t) => Number((t as { quoteIn: BN }).quoteIn.toString()))
  const total = amounts.reduce((a, b) => a + b, 0)

  return {
    trades,
    quoteDecimal: DEFAULT_QUOTE_DECIMAL,
    baseDecimal: DEFAULT_BASE_DECIMAL,
    collectFeeMode: 0,
    summary: {
      kind: 'synthetic',
      label: `${buys} buys, ${totalQuote} SOL, ${shape}`,
      buys: trades.length,
      totalQuote: total / 10 ** DEFAULT_QUOTE_DECIMAL,
      largestBuyShare: total ? Math.max(...amounts) / total : 0,
    },
  }
}

/**
 * Replay the real pool's own curve against the same buy-only flow.
 *
 * This is the honest baseline. Comparing a buys-only counterfactual against the
 * launch's full on-chain history, sells included, would flatter or punish the
 * designed curve for a difference that has nothing to do with its shape. Both
 * sides see exactly the same orders; the only variable left is the curve.
 */
function runBaseline(history: PoolHistory, trades: SimTrade[]): Baseline {
  const config = decodeStoredConfig(history)
  const poolState = decodeStoredPool(history)
  const shape = realCurveShape(history)

  const result = simulate({
    config,
    trades,
    tokenBaseDecimal: history.tokenBaseDecimal,
    tokenQuoteDecimal: history.tokenQuoteDecimal,
    totalTokenSupply: history.totalTokenSupplyUi,
    activationPoint: poolState.activationPoint,
  })

  const outcome = toOutcome(
    {
      id: 'baseline',
      label: 'Actual curve',
      slot: -1,
      curve: {
        migrationThresholdQuote: shape.migrationThresholdQuote,
        curveLength: shape.curveLength,
        baseFeeBps: shape.baseFeeBps,
        creatorTradingFeePercentage: shape.creatorTradingFeePercentage,
        totalTokenSupply: shape.totalTokenSupply,
      },
    },
    result,
    config.migrationQuoteThreshold as BN,
    history.tokenQuoteDecimal,
    history.collectFeeMode,
    { initialMarketCap: shape.initialMarketCap, migrationMarketCap: shape.migrationMarketCap },
  )

  return {
    ...outcome,
    pool: history.pool,
    onChain: {
      graduatedAtTrade: history.stats.graduatedAtTrade,
      buys: history.stats.buys,
      sells: history.stats.sells,
      lifetimeSeconds: history.stats.lifetimeSeconds,
      failedTransactions: history.stats.failedTransactions,
    },
  }
}

export function runSimulation(req: SimulateRequest): SimulateResponse {
  const started = Date.now()
  const { trades, summary, history, quoteDecimal, baseDecimal, collectFeeMode } =
    resolveDemand(req)

  const curves = req.curves.map((c): CurveOutcome => {
    try {
      // Decimals and fee mode are taken from the demand source rather than
      // defaulted. A designed curve is being measured against the pool that
      // supplied the orders, and a different fee basis would change the fee
      // total for a reason that has nothing to do with the curve's shape.
      const built = buildCurveForThreshold({
        totalTokenSupply: c.curve.totalTokenSupply,
        migrationThresholdQuote: c.curve.migrationThresholdQuote,
        curveLength: c.curve.curveLength,
        baseFeeBps: c.curve.baseFeeBps,
        creatorTradingFeePercentage: c.curve.creatorTradingFeePercentage,
        tokenQuoteDecimal: quoteDecimal,
        tokenBaseDecimal: baseDecimal,
        collectFeeMode,
      })
      const config: QuotableConfig = built.config
      const result = simulate({
        config,
        trades,
        tokenBaseDecimal: baseDecimal,
        tokenQuoteDecimal: quoteDecimal,
        totalTokenSupply: c.curve.totalTokenSupply,
      })
      return toOutcome(c, result, built.config.migrationQuoteThreshold, quoteDecimal, collectFeeMode, {
        initialMarketCap: built.initialMarketCap,
        migrationMarketCap: built.migrationMarketCap,
      })
    } catch (e) {
      // A curve the SDK refuses to build is a real answer, not a crash: some
      // combinations (migration below start, a fee out of range) have no valid
      // on-chain representation. Report it against that curve and keep the
      // others, rather than failing the whole comparison.
      return {
        id: c.id, label: c.label, slot: c.slot, curve: c.curve,
        migrationThresholdQuote: 0, initialMarketCap: 0, migrationMarketCap: 0,
        graduatedAtTrade: null, tradesThroughCurve: 0,
        quoteThroughCurve: 0, quoteStranded: 0, quoteUnfilled: 0, tradingFee: 0, protocolFee: 0,
        finalMarketCap: 0, quoteToGraduate: 0, series: [],
        error: (e as Error).message,
      }
    }
  })

  return {
    demand: summary,
    curves,
    baseline: history ? runBaseline(history, trades) : undefined,
    elapsedMs: Date.now() - started,
  }
}
