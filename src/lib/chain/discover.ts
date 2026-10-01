import type BN from 'bn.js'
import type { PoolConfig } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { DBC_PROGRAM_ID } from './program'
import { decodePoolBase64, decodeConfigBase64, type DbcPoolState } from './accounts'
import { poolsTouched } from './events'
import type { SolanaRpc } from './rpc'

export interface PoolCandidate {
  pool: string
  /** Swaps seen for this pool within the sampled window, not its lifetime total. */
  swapsInSample: number
  graduated: boolean
  quoteReserve: string
  migrationQuoteThreshold: string
  /** Share of the curve consumed, 0 to 1. */
  progress: number
  baseMint: string
}

export interface DiscoverOptions {
  /** Recent program signatures to sample. */
  sampleSize?: number
  /** Only return pools that have reached their migration threshold. */
  graduatedOnly?: boolean
  limit?: number
  onProgress?: (phase: string, done: number, total: number) => void
}

interface RawAccount {
  data: [string, string]
}

/**
 * Fetch many accounts with `getMultipleAccounts`, which takes up to 100 keys
 * per call, and batch those calls on top. Resolving a few hundred accounts
 * this way costs a handful of requests rather than a few hundred.
 */
async function getAccounts(
  rpc: SolanaRpc,
  addresses: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, RawAccount>> {
  const chunks: string[][] = []
  for (let i = 0; i < addresses.length; i += 100) chunks.push(addresses.slice(i, i + 100))

  const results = await rpc.batch<{ value: (RawAccount | null)[] }>(
    'getMultipleAccounts',
    chunks.map((c) => [c, { encoding: 'base64' }]),
    onProgress,
  )

  const out = new Map<string, RawAccount>()
  for (let c = 0; c < chunks.length; c++) {
    const values = results[c]?.value ?? []
    for (let i = 0; i < chunks[c].length; i++) {
      const acc = values[i]
      if (acc) out.set(chunks[c][i], acc)
    }
  }
  return out
}

/**
 * Find live DBC pools worth backfilling, from the program transaction stream.
 *
 * Meteora publishes no public pool index, so discovery reads the chain
 * directly: sample recent transactions against the DBC program, decode which
 * pools they traded, then inspect those pool accounts to see how far along
 * each curve is.
 *
 * Sampling recent activity biases towards pools trading right now, which is
 * the right bias here. A pool nobody is trading has no demand flow to replay.
 *
 * Both account decodes go through `accounts.ts` rather than naming a layout
 * directly, for two reasons. Token-2022 launches are stored under a different
 * discriminator and would otherwise be dropped silently, and the real pool
 * fields live one level down inside `poolState`, so reading `quoteReserve` off
 * the decoded account yields `undefined` rather than an error.
 */
export async function discoverPools(
  rpc: SolanaRpc,
  opts: DiscoverOptions = {},
): Promise<PoolCandidate[]> {
  const sampleSize = opts.sampleSize ?? 300
  const report = opts.onProgress ?? (() => {})

  const signatures = await rpc.call<{ signature: string; err: unknown | null }[]>(
    'getSignaturesForAddress',
    [DBC_PROGRAM_ID, { limit: Math.min(1000, sampleSize) }],
  )
  const succeeded = signatures.filter((s) => !s.err).map((s) => s.signature)
  report('signatures', succeeded.length, succeeded.length)

  const txs = await rpc.getTransactions(succeeded, (d, t) => report('transactions', d, t))

  const counts = new Map<string, number>()
  for (const tx of txs) {
    for (const pool of poolsTouched(tx)) counts.set(pool, (counts.get(pool) ?? 0) + 1)
  }
  if (counts.size === 0) return []

  const poolAddresses = [...counts.keys()]
  const poolAccounts = await getAccounts(rpc, poolAddresses, (d, t) => report('pools', d, t))

  const pools = new Map<string, DbcPoolState>()
  for (const address of poolAddresses) {
    const acc = poolAccounts.get(address)
    if (!acc) continue
    const decoded = decodePoolBase64(acc.data[0])
    if (decoded) pools.set(address, decoded.state)
  }

  // Many pools share a config, so dedupe before fetching.
  const configAddresses = [...new Set([...pools.values()].map((p) => String(p.config)))]
  const configAccounts = await getAccounts(rpc, configAddresses, (d, t) => report('configs', d, t))

  const configs = new Map<string, PoolConfig>()
  for (const address of configAddresses) {
    const acc = configAccounts.get(address)
    if (!acc) continue
    const decoded = decodeConfigBase64(acc.data[0])
    if (decoded) configs.set(address, decoded.config)
  }

  const candidates: PoolCandidate[] = []
  for (const [address, state] of pools) {
    const config = configs.get(String(state.config))
    if (!config) continue

    const quoteReserve = state.quoteReserve
    const threshold = config.migrationQuoteThreshold as BN
    if (!quoteReserve || !threshold) continue

    const graduated = Number(state.isMigrated) === 1 || quoteReserve.gte(threshold)

    candidates.push({
      pool: address,
      swapsInSample: counts.get(address) ?? 0,
      graduated,
      quoteReserve: quoteReserve.toString(),
      migrationQuoteThreshold: threshold.toString(),
      progress: threshold.isZero()
        ? 0
        : Math.min(1, Number(quoteReserve.toString()) / Number(threshold.toString())),
      baseMint: String(state.baseMint),
    })
  }

  const filtered = opts.graduatedOnly ? candidates.filter((c) => c.graduated) : candidates
  filtered.sort((a, b) => b.swapsInSample - a.swapsInSample)
  return filtered.slice(0, opts.limit ?? 20)
}
