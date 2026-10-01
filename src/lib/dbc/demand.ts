import BN from 'bn.js'
import type { SimTrade } from './types'

/**
 * How a launch's buy demand is distributed over its trades.
 *
 * Shape matters more than total. The same 120 SOL arriving as one sniper buy
 * plus a long tail graduates a curve at a completely different point than 120
 * SOL arriving evenly, because the curve prices each buy off the state the
 * previous one left behind.
 *
 * Every shape is a deterministic function of its inputs. No randomness: the
 * same controls must always produce the same path, or a comparison between two
 * curves is measuring noise rather than the curves.
 */
export type DemandShape = 'flat' | 'frontloaded' | 'organic'

export const DEMAND_SHAPES: { id: DemandShape; label: string; detail: string }[] = [
  { id: 'flat', label: 'Flat', detail: 'Every buy the same size. A control, not a real launch.' },
  {
    id: 'frontloaded',
    label: 'Front-loaded',
    detail: 'Snipers take the open, demand decays. What most launches actually look like.',
  },
  {
    id: 'organic',
    label: 'Organic',
    detail: 'Quiet open, builds to a peak, fades. A launch found by the market rather than bots.',
  },
]

/** Relative weight of buy `i` of `n`, before normalising to the total. */
function weight(shape: DemandShape, i: number, n: number): number {
  const t = n <= 1 ? 0 : i / (n - 1)
  switch (shape) {
    case 'flat':
      return 1
    // Exponential decay: the open is worth several times the tail.
    case 'frontloaded':
      return Math.exp(-3 * t)
    // Gamma-like hump: rises, peaks around a third of the way in, fades.
    case 'organic':
      return Math.pow(t + 0.05, 1.6) * Math.exp(-3.2 * t)
  }
}

export interface SyntheticDemandSpec {
  shape: DemandShape
  /** Number of buy orders. */
  buys: number
  /** Total quote tokens across every buy, in whole units (e.g. SOL). */
  totalQuote: number
  tokenQuoteDecimal: number
}

/**
 * Build a buy-only demand flow.
 *
 * Sells are deliberately absent. A sell is denominated in base tokens, and how
 * many base tokens a seller holds depends on the curve they bought on, so a
 * sell cannot be held constant across two different curves. Buy demand is
 * denominated in SOL and does transfer, which is what makes a comparison fair.
 */
export function syntheticTrades(spec: SyntheticDemandSpec): SimTrade[] {
  const { shape, tokenQuoteDecimal } = spec
  const n = Math.max(1, Math.floor(spec.buys))
  const scale = 10 ** tokenQuoteDecimal

  const weights = Array.from({ length: n }, (_, i) => weight(shape, i, n))
  const sum = weights.reduce((a, b) => a + b, 0)
  const totalLamports = Math.round(spec.totalQuote * scale)

  // Distribute by largest-remainder so the parts sum to the total exactly.
  // Rounding each share independently loses or gains lamports, which would
  // make two shapes of the "same" total quietly differ in how much they spend.
  const exact = weights.map((w) => (totalLamports * w) / sum)
  const floors = exact.map((v) => Math.floor(v))
  let remainder = totalLamports - floors.reduce((a, b) => a + b, 0)

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    floors[order[k].i]++
  }

  return floors
    .filter((lamports) => lamports > 0)
    .map((lamports) => ({ side: 'buy' as const, quoteIn: new BN(lamports) }))
}
