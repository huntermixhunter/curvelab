import { describe, expect, it } from 'vitest'
import { buildCurve, buildCurveForThreshold } from '../curve'

const SUPPLY = 1_000_000_000
const thresholdOf = (c: { migrationQuoteThreshold: { toString(): string } }) =>
  Number(c.migrationQuoteThreshold.toString()) / 1e9

const build = (migrationThresholdQuote: number, curveLength: number) =>
  buildCurveForThreshold({
    totalTokenSupply: SUPPLY,
    baseFeeBps: 25,
    migrationThresholdQuote,
    curveLength,
  })

describe('buildCurveForThreshold', () => {
  // The inversion assumes the threshold is linear in the market-cap level at a
  // fixed ratio. If a future SDK version breaks that assumption, these targets
  // stop being hit and this is the test that says so.
  it.each([
    [1, 100],
    [5.48, 1.641],
    [10.96, 1.641],
    [85, 20],
    [3000, 2],
  ])('hits a %s SOL target at %sx length', (target, length) => {
    const built = build(target, length)
    const actual = thresholdOf(built.config)
    expect(Math.abs(actual - target) / target).toBeLessThan(1e-6)
  })

  it('honours the requested curve length', () => {
    const built = build(42, 7.5)
    expect(built.migrationMarketCap / built.initialMarketCap).toBeCloseTo(7.5, 6)
  })

  it('scales the market cap level with the threshold at fixed length', () => {
    const small = build(10, 4)
    const large = build(100, 4)
    expect(large.initialMarketCap / small.initialMarketCap).toBeCloseTo(10, 6)
  })

  it('clamps a length at or below 1, which has no valid curve', () => {
    // Migration at or under the start price makes the SDK throw from deep
    // inside its solver, so the floor is applied before it gets there.
    expect(() => build(10, 1)).not.toThrow()
    expect(() => build(10, 0.5)).not.toThrow()
  })

  it('agrees with a direct build at the solved market caps', () => {
    const built = build(63.5, 12)
    const direct = buildCurve({
      totalTokenSupply: SUPPLY,
      baseFeeBps: 25,
      initialMarketCap: built.initialMarketCap,
      migrationMarketCap: built.migrationMarketCap,
    })
    expect(thresholdOf(direct)).toBeCloseTo(thresholdOf(built.config), 9)
  })
})
