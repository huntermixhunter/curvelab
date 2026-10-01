/** Convert the 0..1000 slider track into a bounded value with three significant digits. */
export function rangeValue(position: number, min: number, max: number, log = false, step?: number) {
  const fraction = Math.max(0, Math.min(1000, position)) / 1000
  const raw = log ? min * Math.pow(max / min, fraction) : min + fraction * (max - min)
  const increment = log ? 10 ** (Math.floor(Math.log10(raw)) - 2) : step
  const rounded = increment ? Math.round(raw / increment) * increment : raw
  return Math.max(min, Math.min(max, rounded))
}
