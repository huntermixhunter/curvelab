import { describe, expect, it } from 'vitest'
import { rangeValue } from '../range'

describe('logarithmic slider values', () => {
  it('keeps the curve length above one at the lower endpoint', () => {
    expect(rangeValue(0, 1.05, 1000, true)).toBe(1.05)
  })
  it('preserves fractional SOL targets', () => {
    expect(rangeValue(0, 0.5, 5000, true)).toBe(0.5)
    expect(rangeValue(0, 0.000499, 5000, true)).toBeCloseTo(0.000499, 8)
  })
  it('stays inside the bounds across the full track', () => {
    for (let p = 0; p <= 1000; p++) {
      const value = rangeValue(p, 1.05, 1000, true)
      expect(value).toBeGreaterThanOrEqual(1.05)
      expect(value).toBeLessThanOrEqual(1000)
    }
  })
})
