import { describe, expect, it } from 'vitest'
import { runSimulation } from '../simulate-service'
import { comparisonIssue, listPools, loadPool } from '../corpus'
import { POST } from '../../../app/api/simulate/route'
import type { CurveRequest } from '../../api/types'

const pool = '7CSnmLkKq4XD1DRZW3FuLbS6xebpaDtg6j3zjzzkwt6U'
const curve = (threshold: number): CurveRequest => ({
  id: 'a', label: 'Test curve', slot: 0,
  curve: {
    migrationThresholdQuote: threshold, curveLength: 1.6410170418468946,
    baseFeeBps: 25, creatorTradingFeePercentage: 0, totalTokenSupply: 1e9,
  },
})

describe('comparison accounting', () => {
  it('accounts for all submitted SOL, including the unfilled graduation buy', () => {
    const response = runSimulation({ curves: [curve(5.48)], demand: { kind: 'pool', pool } })
    const designed = response.curves[0]
    expect(designed.error).toBeUndefined()
    expect(designed.graduatedAtTrade).toBe(1)
    expect(designed.quoteUnfilled).toBeGreaterThan(2)
    for (const outcome of [designed, response.baseline!]) {
      expect(outcome.quoteThroughCurve + outcome.quoteStranded + outcome.quoteUnfilled)
        .toBeCloseTo(response.demand.totalQuote, 8)
    }
  })
  it('values output-token fees in SOL and separates protocol fees', () => {
    const response = runSimulation({ curves: [curve(21.92)], demand: { kind: 'pool', pool } })
    expect(response.curves[0].tradingFee).toBeCloseTo(0.04384, 6)
    expect(response.baseline!.tradingFee).toBeCloseTo(0.02192, 6)
    expect(response.curves[0].protocolFee).toBeCloseTo(0.01096, 6)
  })
  it('accounts for an entire single-buy synthetic order', () => {
    const response = runSimulation({
      curves: [curve(5)], demand: { kind: 'synthetic', shape: 'flat', buys: 1, totalQuote: 20 },
    })
    const outcome = response.curves[0]
    expect(outcome.error).toBeUndefined()
    expect(outcome.quoteStranded).toBe(0)
    expect(outcome.quoteUnfilled).toBeGreaterThan(14)
    expect(outcome.quoteThroughCurve + outcome.quoteUnfilled).toBeCloseTo(20, 8)
  })
})

describe('replay availability', () => {
  it('offers only pools whose seeded comparisons can be simulated', () => {
    const pools = listPools()
    expect(pools.some((p) => p.pool === pool)).toBe(true)
    for (const p of pools) {
      expect(comparisonIssue(loadPool(p.pool)!)).toBeNull()
    }
    const extreme = loadPool('YNyhJEAs6hsFkctqNRsTJZdDXujE33sFGxi2nry4kdF')!
    expect(comparisonIssue(extreme)).toContain('parameter range')
    expect(pools.some((p) => p.pool === extreme.pool)).toBe(false)
  })
  it('rejects oversized histories instead of silently dropping buy orders', () => {
    const history = loadPool(pool)!
    const buy = history.trades.find((t) => t.side === 'buy')!
    expect(comparisonIssue({ ...history, trades: Array(6001).fill(buy) })).toContain('buy-order count')
  })
  it('returns a client error for an unknown pool', async () => {
    const response = await POST(new Request('http://localhost/api/simulate', {
      method: 'POST', body: JSON.stringify({ curves: [curve(5)], demand: { kind: 'pool', pool: '../missing' } }),
    }))
    expect(response.status).toBe(400)
  })
})
