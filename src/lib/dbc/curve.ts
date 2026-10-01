import {
  buildCurveWithMarketCap,
  BaseFeeMode, ActivationType, CollectFeeMode, MigrationOption,
  MigrationFeeOption, TokenType, TokenDecimal, TokenAuthorityOption,
  type ConfigParameters,
} from '@meteora-ag/dynamic-bonding-curve-sdk'

/**
 * The knobs a curve designer actually turns. Everything else in the SDK's
 * nested param object is held at a sane default and can be surfaced later.
 */
export interface CurveSpec {
  totalTokenSupply: number
  /** Market cap at launch, in quote tokens. */
  initialMarketCap: number
  /** Market cap at which the pool graduates to DAMM v2, in quote tokens. */
  migrationMarketCap: number
  /** Flat base fee in basis points. 25 min, 9900 max. */
  baseFeeBps: number
  tokenBaseDecimal?: TokenDecimal
  tokenQuoteDecimal?: number
  dynamicFeeEnabled?: boolean
  /** Share of trading fees routed to the token creator, 0-100. */
  creatorTradingFeePercentage?: number
  /**
   * Which token fees are taken in. Quote means fees always accrue in SOL;
   * output means a buy pays its fee in the token being bought. Real pools use
   * both, so a counterfactual has to be able to match the pool it is compared
   * against or the fee totals are not in the same units.
   */
  collectFeeMode?: CollectFeeMode
}

/**
 * Build a DBC config from a high-level spec.
 *
 * Delegates entirely to the SDK's `buildCurveWithMarketCap`, so the resulting
 * config is byte-identical to what a real on-chain launch would use. Note the
 * SDK takes a *nested* param object; passing flat params throws.
 */
export function buildCurve(spec: CurveSpec): ConfigParameters {
  const {
    totalTokenSupply, initialMarketCap, migrationMarketCap, baseFeeBps,
    tokenBaseDecimal = TokenDecimal.SIX,
    tokenQuoteDecimal = TokenDecimal.NINE,
    dynamicFeeEnabled = false,
    creatorTradingFeePercentage = 0,
    collectFeeMode = CollectFeeMode.QuoteToken,
  } = spec

  return buildCurveWithMarketCap({
    initialMarketCap,
    migrationMarketCap,
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: baseFeeBps,
          endingFeeBps: baseFeeBps,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled,
      collectFeeMode,
      creatorTradingFeePercentage,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 100,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Slot,
  })
}

/** A curve described by the two decisions an operator actually makes. */
export interface ScaledCurveSpec extends Omit<CurveSpec, 'initialMarketCap' | 'migrationMarketCap'> {
  /** Quote tokens required to graduate. */
  migrationThresholdQuote: number
  /** Migration market cap divided by start market cap. Always above 1. */
  curveLength: number
}

export interface ScaledCurve {
  config: ConfigParameters
  initialMarketCap: number
  migrationMarketCap: number
}

/**
 * Build a curve from a target graduation threshold and a curve length.
 *
 * The SDK builds from two market caps, but those are the wrong controls to put
 * in front of someone designing a launch. The threshold they imply depends on
 * how much base supply the curve sells, so the same two caps mean 11 SOL on one
 * pool's configuration and 187 SOL under these defaults. Market caps also do
 * not compare across tokens, while "how much SOL does it take to graduate"
 * compares across every pool on the program.
 *
 * Inverting is exact rather than iterative. At a fixed ratio between the two
 * caps, the threshold scales perfectly linearly with the market-cap level
 * (verified to six decimal places across three ratios and four levels), so one
 * build at unit scale gives the constant and the level follows by division.
 */
export function buildCurveForThreshold(spec: ScaledCurveSpec): ScaledCurve {
  const { migrationThresholdQuote, curveLength, ...rest } = spec
  const ratio = Math.max(1.0001, curveLength)
  const quoteDecimal = spec.tokenQuoteDecimal ?? 9

  const unit = buildCurve({ ...rest, initialMarketCap: 1, migrationMarketCap: ratio })
  const unitThreshold = Number(unit.migrationQuoteThreshold.toString()) / 10 ** quoteDecimal
  if (!(unitThreshold > 0)) throw new Error('curve length produced a zero migration threshold')

  const initialMarketCap = migrationThresholdQuote / unitThreshold
  const migrationMarketCap = initialMarketCap * ratio

  return {
    config: buildCurve({ ...rest, initialMarketCap, migrationMarketCap }),
    initialMarketCap,
    migrationMarketCap,
  }
}
