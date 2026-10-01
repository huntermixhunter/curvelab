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
      collectFeeMode: CollectFeeMode.QuoteToken,
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
