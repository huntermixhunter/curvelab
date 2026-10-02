import { describe, expect, it } from 'vitest'
import {
  availabilityIssue, createPreset, exportPreset, importPreset, MAX_PRESET_BYTES,
  parsePreset, STARTER_PRESETS,
} from '../catalog'
import { readLibrary, savePreset, STORAGE_KEY } from '../storage'
import { runSimulation } from '../../server/simulate-service'

const pool = '7CSnmLkKq4XD1DRZW3FuLbS6xebpaDtg6j3zjzzkwt6U'
const fresh = () => structuredClone(STARTER_PRESETS[0])

describe('portable preset experiments', () => {
  it.each(STARTER_PRESETS.map((p) => [p.name, p] as const))('runs %s and preserves its outcomes through export/import', (_, preset) => {
    const restored = importPreset(exportPreset(preset))
    const before = runSimulation(preset.simulation)
    const after = runSimulation(restored.simulation)
    expect(after.curves.every((c) => !c.error && c.series.length > 0)).toBe(true)
    expect(after.curves).toEqual(before.curves)
    expect(after.demand).toEqual(before.demand)
    for (const c of after.curves) {
      expect(c.quoteThroughCurve + c.quoteUnfilled + c.quoteStranded).toBeCloseTo(after.demand.totalQuote, 8)
    }
  })

  it('preserves real demand, creator shares, and baseline results', () => {
    const preset = fresh()
    preset.simulation.demand = { kind: 'pool', pool }
    preset.simulation.curves[0].curve.creatorTradingFeePercentage = 37
    const restored = importPreset(exportPreset(preset))
    const before = runSimulation(preset.simulation)
    const after = runSimulation(restored.simulation)
    expect(after.curves.every((c) => !c.error)).toBe(true)
    expect(after.curves).toEqual(before.curves)
    expect(after.baseline).toEqual(before.baseline)
    expect(availabilityIssue(restored, [])).toContain('not available')
    expect(availabilityIssue(restored, [pool])).toBeNull()
  })

  it('creates an independent fork while preserving its source', () => {
    const source = fresh()
    const fork = createPreset({ name: 'My variation', description: 'A different target', useCase: 'Migration timing' }, source.simulation, source)
    expect(fork.id).not.toBe(source.id)
    expect(fork.forkedFrom).toEqual({ id: source.id, name: source.name })
    fork.simulation.curves[0].curve.migrationThresholdQuote = 500
    expect(source.simulation.curves[0].curve.migrationThresholdQuote).toBe(40)
    expect(importPreset(exportPreset(fork))).toEqual(fork)
  })

  it.each([
    ['NaN', NaN], ['infinity', Infinity], ['numeric string', '40'], ['null', null],
    ['negative', -1], ['zero', 0], ['beyond engine limits', 1e10],
  ])('rejects %s as a graduation target', (_, invalid) => {
    const preset = fresh()
    Object.assign(preset.simulation.curves[0].curve, { migrationThresholdQuote: invalid })
    expect(() => parsePreset(preset)).toThrow('Graduation target')
  })

  it('rejects a future version and a file from another app', () => {
    expect(() => parsePreset({ ...fresh(), version: 2 })).toThrow('Unsupported preset version')
    expect(() => parsePreset({ ...fresh(), format: 'deployment-config' })).toThrow('not a Curve Lab preset')
  })

  it('rejects ambiguous comparisons and impossible demand', () => {
    const sameID = fresh()
    sameID.simulation.curves[1].id = sameID.simulation.curves[0].id
    expect(() => parsePreset(sameID)).toThrow('unique')
    const reserved = fresh()
    reserved.simulation.curves[0].id = 'baseline'
    expect(() => parsePreset(reserved)).toThrow('reserved')
    const sameSlot = fresh()
    sameSlot.simulation.curves[1].slot = 0
    expect(() => parsePreset(sameSlot)).toThrow('different color')
    const mixedSupply = fresh()
    mixedSupply.simulation.curves[1].curve.totalTokenSupply = 5e9
    expect(() => parsePreset(mixedSupply)).toThrow('same token supply')
    const oversized = fresh()
    oversized.simulation.demand = { kind: 'synthetic', shape: 'flat', buys: 6001, totalQuote: 120 }
    expect(() => parsePreset(oversized)).toThrow('Buy orders')
    oversized.simulation.demand.buys = 1.5
    expect(() => parsePreset(oversized)).toThrow('integer')
    oversized.simulation.demand = { kind: 'pool', pool: '../fixture' }
    expect(() => parsePreset(oversized)).toThrow('public key')
  })

  it('rejects malformed and oversized files without executing unknown fields', () => {
    expect(() => importPreset('{')).toThrow('valid JSON')
    expect(() => importPreset(' '.repeat(MAX_PRESET_BYTES + 1))).toThrow('64 KB')
    expect(() => importPreset('é'.repeat(MAX_PRESET_BYTES))).toThrow('64 KB')
    const text = exportPreset(fresh()).replace('"format":', '"__proto__": { "polluted": true }, "format":')
    const parsed = importPreset(text)
    expect(Object.hasOwn(parsed, '__proto__')).toBe(false)
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)
  })
})

describe('local preset persistence', () => {
  function memoryStorage(initial = '') {
    let value = initial
    return {
      getItem(key: string) { expect(key).toBe(STORAGE_KEY); return value || null },
      setItem(key: string, next: string) { expect(key).toBe(STORAGE_KEY); value = next },
    }
  }

  it('keeps existing presets when another save is made and rejects duplicate imports', () => {
    const storage = memoryStorage()
    savePreset(fresh(), storage)
    savePreset(STARTER_PRESETS[1], storage)
    expect(readLibrary(storage.getItem(STORAGE_KEY)!)).toEqual([STARTER_PRESETS[1], fresh()])
    expect(() => savePreset(fresh(), storage)).toThrow('already in your library')
  })

  it('does not overwrite unreadable or newer-version libraries', () => {
    for (const invalid of ['{', 'null', JSON.stringify({ version: 2, presets: [] })]) {
      const storage = memoryStorage(invalid)
      expect(() => savePreset(fresh(), storage)).toThrow('left untouched')
      expect(storage.getItem(STORAGE_KEY)).toBe(invalid)
    }
  })

  it('reports a failed browser write and leaves the existing library intact', () => {
    const storage = memoryStorage()
    savePreset(fresh(), storage)
    const before = storage.getItem(STORAGE_KEY)
    expect(() => savePreset(STARTER_PRESETS[1], {
      getItem: storage.getItem, setItem() { throw new Error('QuotaExceededError') },
    })).toThrow('could not save')
    expect(storage.getItem(STORAGE_KEY)).toBe(before)
  })
})
