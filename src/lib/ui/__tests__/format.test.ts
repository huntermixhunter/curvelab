import { describe, expect, it } from 'vitest'
import { niceTicks, sig } from '../format'

describe('sig', () => {
  it('keeps the trailing zeros of a round integer', () => {
    // Regression: an unconditional trailing-zero trim rendered 120 as "12"
    // and 500 as "5", which silently misreported every whole number in the UI.
    expect(sig(120)).toBe('120')
    expect(sig(500)).toBe('500')
    expect(sig(50)).toBe('50')
    expect(sig(100)).toBe('100')
  })

  it('trims only a fractional tail', () => {
    expect(sig(1.2)).toBe('1.2')
    expect(sig(1.0)).toBe('1')
    expect(sig(10.5)).toBe('10.5')
  })

  it('holds significant figures across magnitudes', () => {
    expect(sig(0.0438)).toBe('0.0438')
    expect(sig(0.000123456)).toBe('0.000123')
    expect(sig(28.843563996)).toBe('28.8')
  })

  it('compacts thousands, millions, and billions', () => {
    expect(sig(1_000)).toBe('1K')
    expect(sig(1_500)).toBe('1.5K')
    expect(sig(1_000_000_000)).toBe('1B')
    expect(sig(28_500_000)).toBe('28.5M')
  })

  it('handles zero and non-finite input', () => {
    expect(sig(0)).toBe('0')
    expect(sig(Number.NaN)).toBe('-')
    expect(sig(Number.POSITIVE_INFINITY)).toBe('-')
  })

  it('keeps negatives signed', () => {
    expect(sig(-120)).toBe('-120')
    expect(sig(-0.5)).toBe('-0.5')
  })
})

describe('niceTicks', () => {
  it('starts at zero and reaches the maximum', () => {
    const ticks = niceTicks(50)
    expect(ticks[0]).toBe(0)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(50)
  })

  it('produces round steps', () => {
    expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100])
    expect(niceTicks(50)).toEqual([0, 20, 40, 60])
  })

  it('does not accumulate floating point drift', () => {
    for (const tick of niceTicks(0.04)) {
      expect(Number(tick.toPrecision(12))).toBe(tick)
    }
  })

  it('degrades safely on a non-positive maximum', () => {
    expect(niceTicks(0)).toEqual([0])
    expect(niceTicks(Number.NaN)).toEqual([0])
  })
})
