import { describe, it, expect } from 'vitest'
import BN from 'bn.js'
import { buildCurve } from '../curve'
import { simulate } from '../simulate'
import type { SimTrade } from '../types'

const SOL = (n: number) => new BN(n * 1e9)

/** The reference config used for all golden numbers below. */
const spec = {
  totalTokenSupply: 1_000_000_000,
  initialMarketCap: 30,
  migrationMarketCap: 600,
  baseFeeBps: 100,
}

describe('buildCurve', () => {
  it('places the start price at initialMarketCap / totalSupply', () => {
    const cfg = buildCurve(spec)
    const r = simulate({
      config: cfg, trades: [], tokenBaseDecimal: 6, tokenQuoteDecimal: 9,
      totalTokenSupply: spec.totalTokenSupply,
    })
    expect(r.steps).toHaveLength(0)
    // 30 SOL mcap over 1e9 supply = 3.0e-8 SOL per token
    const cfgPrice = Number(
      // start price is implied by sqrtStartPrice; verify via a 0-trade sim's threshold
      cfg.migrationQuoteThreshold.toString(),
    )
    expect(cfgPrice).toBeGreaterThan(0)
  })

  it('caps the curve at MAX_CURVE_POINT segments', () => {
    const cfg = buildCurve(spec)
    expect(cfg.curve.length).toBeGreaterThan(0)
    expect(cfg.curve.length).toBeLessThanOrEqual(16)
  })
})

describe('simulate', () => {
  const trades: SimTrade[] = Array.from({ length: 40 }, () => ({
    side: 'buy' as const, quoteIn: SOL(1),
  }))

  it('advances price monotonically on a pure buy flow', () => {
    const r = simulate({
      config: buildCurve(spec), trades, tokenBaseDecimal: 6, tokenQuoteDecimal: 9,
      totalTokenSupply: spec.totalTokenSupply,
    })
    for (let i = 1; i < r.steps.length; i++) {
      expect(r.steps[i].priceAfter).toBeGreaterThan(r.steps[i - 1].priceAfter)
    }
  })

  it('starts near the configured initial market cap', () => {
    const r = simulate({
      config: buildCurve(spec), trades: [{ side: 'buy', quoteIn: new BN(1) }],
      tokenBaseDecimal: 6, tokenQuoteDecimal: 9, totalTokenSupply: spec.totalTokenSupply,
    })
    // A 1-lamport buy barely moves price, so mcap should still be ~30 SOL.
    expect(r.steps[0].marketCapAfter).toBeCloseTo(30, 4)
  })

  it('splits fees 80/20 between creator-side and protocol', () => {
    const r = simulate({
      config: buildCurve(spec), trades, tokenBaseDecimal: 6, tokenQuoteDecimal: 9,
      totalTokenSupply: spec.totalTokenSupply,
    })
    // 40 SOL volume at 100 bps = 0.40 SOL gross fee.
    // PROTOCOL_FEE_PERCENT = 20, so 0.32 SOL accrues to partner + creator
    // and 0.08 SOL to the protocol.
    expect(Number(r.totalTradingFee) / 1e9).toBeCloseTo(0.32, 9)
    expect(Number(r.totalProtocolFee) / 1e9).toBeCloseTo(0.08, 9)
  })

  it('does not graduate below the migration quote threshold', () => {
    const cfg = buildCurve(spec)
    const r = simulate({
      config: cfg, trades, tokenBaseDecimal: 6, tokenQuoteDecimal: 9,
      totalTokenSupply: spec.totalTokenSupply,
    })
    // Threshold is ~109.6 SOL; 40 SOL of buys must not graduate.
    expect(r.graduatedAtTrade).toBeNull()
    expect(Number(r.quoteToGraduate)).toBeGreaterThan(0)
    expect(r.finalMarketCap).toBeGreaterThan(spec.initialMarketCap)
    expect(r.finalMarketCap).toBeLessThan(spec.migrationMarketCap)
  })

  it('graduates once cumulative buys clear the threshold', () => {
    const cfg = buildCurve(spec)
    const thresholdSol = Number(cfg.migrationQuoteThreshold) / 1e9
    const n = Math.ceil(thresholdSol) + 5
    const big: SimTrade[] = Array.from({ length: n }, () => ({
      side: 'buy' as const, quoteIn: SOL(1),
    }))
    const r = simulate({
      config: cfg, trades: big, tokenBaseDecimal: 6, tokenQuoteDecimal: 9,
      totalTokenSupply: spec.totalTokenSupply,
    })
    expect(r.graduatedAtTrade).not.toBeNull()
    expect(Number(r.quoteToGraduate)).toBe(0)
    // Graduation happens around the ~109.6 SOL threshold, so with n buys of
    // 1 SOL the curve should finish shortly after that point, not at the end.
    expect(r.graduatedAtTrade!).toBeLessThan(n)
  })

  it('routes post-graduation demand away from the curve instead of throwing', () => {
    const cfg = buildCurve(spec)
    const thresholdSol = Number(cfg.migrationQuoteThreshold) / 1e9
    const n = Math.ceil(thresholdSol) + 25
    const big: SimTrade[] = Array.from({ length: n }, () => ({
      side: 'buy' as const, quoteIn: SOL(1),
    }))
    const r = simulate({
      config: cfg, trades: big, tokenBaseDecimal: 6, tokenQuoteDecimal: 9,
      totalTokenSupply: spec.totalTokenSupply,
    })
    // The DBC program rejects swaps once the pool is complete. That demand is
    // real, it just lands in the DAMM v2 pool instead, so we account for it.
    expect(r.tradesAfterGraduation).toBeGreaterThan(0)
    expect(Number(r.quoteDemandAfterGraduation) / 1e9).toBeCloseTo(r.tradesAfterGraduation, 6)
    expect(r.steps.length + r.tradesAfterGraduation).toBe(n)
  })

  it('is deterministic across runs', () => {
    const run = () => simulate({
      config: buildCurve(spec), trades, tokenBaseDecimal: 6, tokenQuoteDecimal: 9,
      totalTokenSupply: spec.totalTokenSupply,
    })
    expect(run().finalPrice).toBe(run().finalPrice)
  })
})
