/** Categorical slots, in the fixed validated order. A curve holds its slot. */
export const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'] as const

export const seriesColor = (slot: number) => SERIES_COLORS[slot] ?? 'var(--ink-muted)'

/**
 * Significant-figure formatting for amounts that span many orders of magnitude.
 *
 * A bonding curve puts 0.0004 SOL and 84,000 SOL on the same axis, so a fixed
 * decimal count is wrong at one end or the other. Fixing the significant
 * figures instead keeps every value readable at the precision it deserves.
 */
export function sig(value: number, figures = 3): string {
  if (!Number.isFinite(value)) return '-'
  if (value === 0) return '0'

  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${sig(value / 1e9, figures)}B`
  if (abs >= 1_000_000) return `${sig(value / 1e6, figures)}M`
  if (abs >= 1_000) return `${sig(value / 1e3, figures)}K`

  const decimals = Math.max(0, figures - 1 - Math.floor(Math.log10(abs)))
  const text = value.toFixed(Math.min(decimals, 8))

  // Trim only a fractional tail. Running the trim unconditionally eats the
  // trailing zeros of a round integer, which silently turned 120 into "12"
  // and 500 into "5" everywhere a whole number was displayed.
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

export const sol = (value: number, figures = 3) => `${sig(value, figures)} SOL`

export const pct = (ratio: number, decimals = 0) => `${(ratio * 100).toFixed(decimals)}%`

/**
 * Axis ticks on round numbers, covering zero through the maximum.
 *
 * The last tick is at or above `max` rather than at or below it. Stopping
 * below leaves the top of the data above the highest gridline with nothing to
 * read it against: `niceTicks(50)` used to end at 40, so a series peaking at 50
 * ran off the top of its own axis.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0]

  const rough = max / count
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10

  const steps = Math.ceil(max / step - 1e-9)
  // Multiply rather than accumulate: repeated addition of a step like 0.01
  // drifts in binary floating point and prints ticks as 0.30000000000000004.
  return Array.from({ length: steps + 1 }, (_, i) => i * step)
}

/** Seconds to the coarsest unit that still reads precisely. */
export function duration(seconds: number | null): string {
  if (seconds === null) return '-'
  if (seconds < 90) return `${seconds}s`
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

export const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`
