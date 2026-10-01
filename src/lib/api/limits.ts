/** Shared bounds for request validation and supported replay comparisons. */
export const SIMULATION_LIMITS = {
  curves: 3,
  baseFeeBps: { min: 25, max: 9_900 },
  threshold: { min: 1e-6, max: 1e9 },
  curveLength: { min: 1.001, max: 100_000 },
  supply: { min: 1_000, max: 1e15 },
  buys: { min: 1, max: 6_000 },
  totalQuote: { min: 1e-6, max: 1e9 },
} as const

export class SimulationInputError extends Error {}
