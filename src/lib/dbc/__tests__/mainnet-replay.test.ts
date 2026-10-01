import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { POOL_HISTORY_SCHEMA, findReserveGaps, type PoolHistory } from '../../chain/backfill'
import { verifyAgainstChain } from '../replay'

/**
 * Replay every stored mainnet pool and require the engine to reproduce the
 * chain exactly.
 *
 * This is the test the whole project rests on. A simulated price path is only
 * worth something if the same arithmetic reproduces launches that already
 * happened, down to the last lamport. Fixtures carry the raw config bytes, so
 * this runs fully offline and is safe in CI.
 */
const POOL_DIR = join(process.cwd(), 'data', 'pools')

const fixtures = existsSync(POOL_DIR)
  ? readdirSync(POOL_DIR).filter((f) => f.endsWith('.json'))
  : []

describe('mainnet replay', () => {
  it('has at least one captured pool to replay', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const file of fixtures) {
    const history = JSON.parse(readFileSync(join(POOL_DIR, file), 'utf8')) as PoolHistory
    const label = `${history.pool.slice(0, 8)}... (${history.stats.swaps} swaps)`

    describe(label, () => {
      it('was captured by the current fixture schema', () => {
        expect(history.schema).toBe(POOL_HISTORY_SCHEMA)
      })

      it('is provably complete: the reserve chain has no gaps', () => {
        // Recomputed here rather than trusting the stored flag, so a
        // hand-edited fixture cannot claim completeness it does not have.
        expect(findReserveGaps(history.trades)).toEqual([])
        expect(history.integrity.continuous).toBe(true)
      })

      it('reproduces every swap the program recorded, exactly', () => {
        const verdict = verifyAgainstChain(history)
        expect(verdict.mismatches).toEqual([])
        expect(verdict.matched).toBe(history.trades.length)
        expect(verdict.exact).toBe(true)
      })

      it('reaches graduation on the same trade the chain did', () => {
        const verdict = verifyAgainstChain(history)
        expect(verdict.result.graduatedAtTrade).toBe(history.stats.graduatedAtTrade)
      })
    })
  }
})
