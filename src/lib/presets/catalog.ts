import { SIMULATION_LIMITS as LIMITS } from '../api/limits'
import type { CurveRequest, SimulateRequest } from '../api/types'

export const PRESET_FORMAT = 'curvelab-preset'
export const PRESET_VERSION = 1
export const MAX_PRESET_BYTES = 64 * 1024
export const MAX_SAVED_PRESETS = 100

/** Portable simulation inputs. This is not an on-chain deployment config. */
export interface Preset {
  format: typeof PRESET_FORMAT
  version: typeof PRESET_VERSION
  id: string
  name: string
  description: string
  useCase: string
  createdAt: string
  forkedFrom?: { id: string; name: string }
  simulation: SimulateRequest
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, max: number, optional = false): string {
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) {
    throw new Error(`${field} must be ${optional ? 'at most' : '1 to'} ${max} characters.`)
  }
  return value.trim()
}

function number(value: unknown, field: string, range: { min: number; max: number }, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < range.min || value > range.max || (integer && !Number.isInteger(value))) {
    throw new Error(`${field} must be ${integer ? 'an integer' : 'a number'} between ${range.min} and ${range.max}.`)
  }
  return value
}

/** Copy known fields only; imported JSON never becomes executable config. */
export function parseSimulation(value: unknown): SimulateRequest {
  const raw = object(value, 'simulation')
  if (!Array.isArray(raw.curves) || raw.curves.length < 1 || raw.curves.length > LIMITS.curves) {
    throw new Error(`A preset needs 1 to ${LIMITS.curves} curves.`)
  }
  const curves: CurveRequest[] = raw.curves.map((entry, i) => {
    const c = object(entry, `Curve ${i + 1}`)
    const p = object(c.curve, `Curve ${i + 1} parameters`)
    return {
      id: text(c.id, 'Curve ID', 64),
      label: text(c.label, 'Curve label', 48),
      slot: number(c.slot, 'Color slot', { min: 0, max: 2 }, true),
      curve: {
        migrationThresholdQuote: number(p.migrationThresholdQuote, 'Graduation target', LIMITS.threshold),
        curveLength: number(p.curveLength, 'Curve length', LIMITS.curveLength),
        baseFeeBps: number(p.baseFeeBps, 'Base fee', LIMITS.baseFeeBps, true),
        creatorTradingFeePercentage: number(p.creatorTradingFeePercentage, 'Creator fee share', { min: 0, max: 100 }, true),
        totalTokenSupply: number(p.totalTokenSupply, 'Token supply', LIMITS.supply),
      },
    }
  })
  if (new Set(curves.map((c) => c.id)).size !== curves.length || curves.some((c) => c.id === 'baseline')) {
    throw new Error('Curve IDs must be unique and cannot use the reserved baseline ID.')
  }
  if (new Set(curves.map((c) => c.slot)).size !== curves.length) {
    throw new Error('Every curve needs a different color slot.')
  }
  if (curves.some((c) => c.curve.totalTokenSupply !== curves[0].curve.totalTokenSupply)) {
    throw new Error('All curves in a comparison must use the same token supply.')
  }
  const d = object(raw.demand, 'Demand')
  if (d.kind === 'pool') {
    const pool = text(d.pool, 'Pool address', 44)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pool)) throw new Error('Pool address must be a Solana public key.')
    return { curves, demand: { kind: 'pool', pool } }
  }
  if (d.kind !== 'synthetic') throw new Error('Demand must be synthetic or pool.')
  if (d.shape !== 'flat' && d.shape !== 'frontloaded' && d.shape !== 'organic') {
    throw new Error('Demand shape must be flat, frontloaded, or organic.')
  }
  return { curves, demand: {
    kind: 'synthetic', shape: d.shape,
    buys: number(d.buys, 'Buy orders', LIMITS.buys, true),
    totalQuote: number(d.totalQuote, 'Total demand', LIMITS.totalQuote),
  } }
}

export function parsePreset(value: unknown): Preset {
  const raw = object(value, 'Preset')
  if (raw.format !== PRESET_FORMAT) throw new Error('This file is not a Curve Lab preset.')
  if (raw.version !== PRESET_VERSION) throw new Error(`Unsupported preset version: ${String(raw.version)}. Expected version 1.`)
  const createdAt = text(raw.createdAt, 'Creation date', 40)
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('Creation date is invalid.')
  const parent = raw.forkedFrom === undefined ? undefined : object(raw.forkedFrom, 'Fork source')
  return {
    format: PRESET_FORMAT, version: PRESET_VERSION,
    id: text(raw.id, 'Preset ID', 80), name: text(raw.name, 'Preset name', 64),
    description: text(raw.description, 'Description', 500, true),
    useCase: text(raw.useCase, 'Intended use', 160, true), createdAt,
    ...(parent ? { forkedFrom: { id: text(parent.id, 'Source ID', 80), name: text(parent.name, 'Source name', 64) } } : {}),
    simulation: parseSimulation(raw.simulation),
  }
}

export function importPreset(json: string): Preset {
  if (new TextEncoder().encode(json).length > MAX_PRESET_BYTES) throw new Error('Preset files must be smaller than 64 KB.')
  let raw: unknown
  try { raw = JSON.parse(json) } catch { throw new Error('The file does not contain valid JSON.') }
  return parsePreset(raw)
}

export function exportPreset(preset: Preset): string {
  return JSON.stringify(parsePreset(preset), null, 2) + '\n'
}

export function createPreset(
  metadata: Pick<Preset, 'name' | 'description' | 'useCase'>,
  simulation: SimulateRequest,
  parent?: Preset,
): Preset {
  return parsePreset({
    ...metadata, format: PRESET_FORMAT, version: PRESET_VERSION,
    id: crypto.randomUUID(), createdAt: new Date().toISOString(), simulation,
    ...(parent ? { forkedFrom: { id: parent.id, name: parent.name } } : {}),
  })
}

const starter = (
  id: string, name: string, description: string, useCase: string,
  shape: 'flat' | 'frontloaded' | 'organic', totalQuote: number,
  settings: [string, number, number, number][],
): Preset => parsePreset({
  format: PRESET_FORMAT, version: PRESET_VERSION, id, name, description, useCase,
  createdAt: '2026-10-01T00:00:00.000Z',
  simulation: {
    demand: { kind: 'synthetic', shape, buys: 120, totalQuote },
    curves: settings.map(([label, target, length, fee], slot) => ({
      id: `${id}-${slot}`, label, slot,
      curve: { migrationThresholdQuote: target, curveLength: length, baseFeeBps: fee,
        creatorTradingFeePercentage: 0, totalTokenSupply: 1e9 },
    })),
  },
})

export const STARTER_PRESETS: readonly Preset[] = [
  starter('starter-graduation', 'The graduation tradeoff',
    'Hold price range and fees fixed. Compare how much demand a 40 SOL or 85 SOL target can absorb before migration.',
    'Explore earlier migration versus a longer DBC phase.', 'frontloaded', 120,
    [['Earlier migration', 40, 20, 100], ['Longer DBC phase', 85, 20, 100]]),
  starter('starter-price', 'Same target, different climb',
    'Three price ranges, one 85 SOL target. Follow price multiples as the same gradual demand reaches each curve.',
    'Isolate the effect of curve length on the price path.', 'organic', 120,
    [['5x climb', 85, 5, 100], ['20x climb', 85, 20, 100], ['80x climb', 85, 80, 100]]),
  starter('starter-fees', 'Fee sensitivity',
    'Replay identical buy orders at 0.25%, 1%, and 2% base fees. Demand stays fixed even when fees change.',
    'Compare fee accounting without assuming traders accept higher fees.', 'flat', 120,
    [['0.25% fee', 85, 20, 25], ['1% fee', 85, 20, 100], ['2% fee', 85, 20, 200]]),
]

export function availabilityIssue(preset: Preset, poolAddresses: string[]): string | null {
  const demand = preset.simulation.demand
  return demand.kind === 'pool' && !poolAddresses.includes(demand.pool)
    ? 'This preset needs a verified launch that is not available on this installation. Import keeps the preset intact; load it where that launch is available.'
    : null
}
