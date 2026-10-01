import { describe, expect, it } from 'vitest'
import BN from 'bn.js'
import { syntheticTrades, DEMAND_SHAPES, type DemandShape } from '../demand'

const LAMPORTS = 1e9
const sizes = (trades: ReturnType<typeof syntheticTrades>) =>
  trades.map((t) => Number((t as { quoteIn: BN }).quoteIn.toString()))

const spec = (shape: DemandShape, buys: number, totalQuote: number) =>
  syntheticTrades({ shape, buys, totalQuote, tokenQuoteDecimal: 9 })

describe('syntheticTrades', () => {
  it.each(DEMAND_SHAPES.map((s) => s.id))('distributes the exact total (%s)', (shape) => {
    // Rounding each share independently loses or gains lamports, which would
    // make two shapes of the "same" total quietly spend different amounts and
    // break the only thing a curve comparison holds constant.
    const total = sizes(spec(shape, 137, 120)).reduce((a, b) => a + b, 0)
    expect(total).toBe(120 * LAMPORTS)
  })

  it('is deterministic', () => {
    expect(sizes(spec('organic', 50, 10))).toEqual(sizes(spec('organic', 50, 10)))
  })

  it('front-loads demand so the open outweighs the tail', () => {
    const s = sizes(spec('frontloaded', 100, 100))
    expect(s[0]).toBeGreaterThan(s[s.length - 1] * 5)
  })

  it('builds organic demand to a peak away from both ends', () => {
    const s = sizes(spec('organic', 100, 100))
    const peak = s.indexOf(Math.max(...s))
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThan(s.length - 1)
  })

  it('spreads flat demand evenly', () => {
    const s = sizes(spec('flat', 100, 100))
    // Largest-remainder leaves at most one lamport of spread.
    expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1)
  })

  it('emits only buys', () => {
    expect(spec('frontloaded', 20, 5).every((t) => t.side === 'buy')).toBe(true)
  })

  it('drops orders that round away to nothing rather than emitting zero buys', () => {
    // A tiny total across many orders cannot give every order a lamport.
    const s = sizes(spec('frontloaded', 500, 1e-7))
    expect(s.length).toBeGreaterThan(0)
    expect(s.every((v) => v > 0)).toBe(true)
    expect(s.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('handles a single buy', () => {
    expect(sizes(spec('organic', 1, 3))).toEqual([3 * LAMPORTS])
  })
})
