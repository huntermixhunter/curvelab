import { describe, it, expect } from 'vitest'
import {
  quoteReserveDelta,
  findReserveGaps,
  reorderWithinSlots,
  type RealTrade,
} from '../backfill'

/**
 * Build a trade with only the fields the reserve arithmetic reads.
 *
 * The real shape carries signatures, slots and prices too, but every function
 * under test works purely from the amounts and the reserve the program
 * reported, so the rest is noise here.
 */
function trade(p: Partial<RealTrade> & Pick<RealTrade, 'side' | 'quoteReserveAfter'>): RealTrade {
  return {
    signature: p.signature ?? `sig-${p.quoteReserveAfter}`,
    slot: p.slot ?? 1,
    blockTime: p.blockTime ?? 1_700_000_000,
    side: p.side,
    amountIn: p.amountIn ?? '0',
    amountFilled: p.amountFilled ?? '0',
    amountExcludedFee: p.amountExcludedFee ?? '0',
    amountLeft: p.amountLeft ?? '0',
    amountOut: p.amountOut ?? '0',
    tradingFee: p.tradingFee ?? '0',
    protocolFee: p.protocolFee ?? '0',
    nextSqrtPrice: p.nextSqrtPrice ?? '0',
    quoteReserveAfter: p.quoteReserveAfter,
  }
}

// A buy adds only what reached the curve. A sell removes what the trader
// received plus the fees, which leave the reserve as well.
const buyA = trade({ side: 'buy', slot: 1, amountExcludedFee: '1000', quoteReserveAfter: '1000' })
const buyB = trade({ side: 'buy', slot: 2, amountExcludedFee: '500', quoteReserveAfter: '1500' })
const sellC = trade({
  side: 'sell', slot: 2,
  amountOut: '300', tradingFee: '20', protocolFee: '5',
  quoteReserveAfter: '1175',
})

describe('quoteReserveDelta', () => {
  it('credits a buy with the amount that reached the curve', () => {
    expect(quoteReserveDelta(buyA).toString()).toBe('1000')
  })

  it('debits a sell by the payout plus both fees', () => {
    // 300 to the trader, 20 trading, 5 protocol: the reserve loses all 325.
    expect(quoteReserveDelta(sellC).toString()).toBe('-325')
  })
})

describe('findReserveGaps', () => {
  it('reports no gaps when every reserve follows from the one before', () => {
    expect(findReserveGaps([buyA, buyB, sellC])).toEqual([])
  })

  it('detects a dropped trade and names the exact missing amount', () => {
    // buyB removed, as a flaky endpoint would silently do.
    const gaps = findReserveGaps([buyA, sellC])
    expect(gaps).toHaveLength(1)
    expect(gaps[0].afterTrade).toBe(0)
    expect(gaps[0].unexplainedQuote).toBe('500')
    expect(gaps[0].fromSignature).toBe(buyA.signature)
    expect(gaps[0].toSignature).toBe(sellC.signature)
  })

  it('detects a trade missing before the very first one', () => {
    const gaps = findReserveGaps([buyB])
    expect(gaps).toHaveLength(1)
    expect(gaps[0].afterTrade).toBe(-1)
    expect(gaps[0].fromSignature).toBeNull()
  })

  it('does not cascade: one gap produces one finding, not one per trade', () => {
    const gaps = findReserveGaps([buyA, sellC, trade({
      side: 'buy', amountExcludedFee: '25', quoteReserveAfter: '1200',
    })])
    expect(gaps).toHaveLength(1)
  })
})

describe('reorderWithinSlots', () => {
  it('restores the true order of trades sharing a slot', () => {
    // buyB and sellC both landed in slot 2 and arrived reversed.
    const fixed = reorderWithinSlots([buyA, sellC, buyB])
    expect(fixed.map((t) => t.quoteReserveAfter)).toEqual(['1000', '1500', '1175'])
    expect(findReserveGaps(fixed)).toEqual([])
  })

  it('leaves an already-correct order untouched', () => {
    const input = [buyA, buyB, sellC]
    expect(reorderWithinSlots(input).map((t) => t.signature)).toEqual(
      input.map((t) => t.signature),
    )
  })

  it('leaves a genuinely incomplete slot alone rather than inventing an order', () => {
    // No permutation can reconcile these, because a trade is missing.
    const orphan = trade({ side: 'buy', slot: 2, amountExcludedFee: '1', quoteReserveAfter: '9999' })
    const out = reorderWithinSlots([buyA, orphan])
    expect(out).toHaveLength(2)
    expect(findReserveGaps(out)).toHaveLength(1)
  })
})
