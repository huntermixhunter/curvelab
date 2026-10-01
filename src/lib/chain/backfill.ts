import BN from 'bn.js'
import { FEE_DENOMINATOR } from '@meteora-ag/dynamic-bonding-curve-sdk'
import {
  decodePoolBase64,
  decodeConfigBase64,
  type DbcPoolState,
  type PoolAccountType,
  type ConfigAccountType,
} from './accounts'
import { extractSwaps, TRADE_DIRECTION, type Swap2Event } from './events'
import type { SolanaRpc, SignatureInfo } from './rpc'

/**
 * Bumped whenever the fixture shape changes in a way replays must notice.
 *
 * 2 added `RealTrade.amountExcludedFee` and the `integrity` block, without
 * which a history cannot be shown to be complete.
 */
export const POOL_HISTORY_SCHEMA = 2

/**
 * One real swap, as the program recorded it.
 *
 * Every amount is a decimal string of lamports, not a number: a u64 of SOL
 * lamports exceeds `Number.MAX_SAFE_INTEGER`, and a u128 sqrt price exceeds it
 * by a wide margin. Parsing these as JSON numbers would quietly round the exact
 * values that make a replay verifiable.
 */
export interface RealTrade {
  signature: string
  slot: number
  blockTime: number | null
  /** 'buy' = quote in, base out. 'sell' = base in, quote out. */
  side: 'buy' | 'sell'
  /** What the trader submitted, fee included. */
  amountIn: string
  /** What the curve actually consumed. Differs from `amountIn` on a partial fill. */
  amountFilled: string
  /**
   * The part of the input that reached the curve after any input-side fee.
   * Equals `amountFilled` when fees are taken from the output token instead.
   */
  amountExcludedFee: string
  /** Returned to the trader because the curve ran out of room. */
  amountLeft: string
  amountOut: string
  tradingFee: string
  protocolFee: string
  nextSqrtPrice: string
  /** Pool quote reserve after this trade, straight from the program. */
  quoteReserveAfter: string
}

export interface PoolHistoryStats {
  signaturesScanned: number
  /** Failed transactions, which on a contested launch outnumber the successes. */
  failedTransactions: number
  swaps: number
  buys: number
  sells: number
  firstBlockTime: number | null
  lastBlockTime: number | null
  lifetimeSeconds: number | null
  /** 1-based index of the trade that reached the migration threshold. */
  graduatedAtTrade: number | null
}

export interface PoolHistory {
  schema: number
  fetchedAt: string
  rpcHost: string

  pool: string
  config: string
  baseMint: string
  quoteMint: string
  creator: string

  tokenBaseDecimal: number
  tokenQuoteDecimal: number
  /** Pre-migration supply in base lamports. */
  totalTokenSupply: string
  /** Pre-migration supply in whole tokens, for market cap arithmetic. */
  totalTokenSupplyUi: number

  sqrtStartPrice: string
  migrationQuoteThreshold: string
  migrationSqrtPrice: string
  collectFeeMode: number
  baseFeeBps: number
  creatorTradingFeePercentage: number
  /** Non-zero curve segments. The on-chain array is padded to 20. */
  curvePoints: number
  isMigrated: boolean

  /**
   * Raw account bytes, base64.
   *
   * A replay re-decodes these rather than reading reconstructed fields. The
   * quote math reads roughly thirty nested fields including a 20-element curve
   * array; hand-mapping them to JSON and back is a large surface for a silent
   * off-by-one, whereas the bytes decode to exactly what the chain held.
   */
  configAccountBase64: string
  poolAccountBase64: string
  /** Which account variant the bytes above are, so a replay decodes the right one. */
  poolAccountType: PoolAccountType
  configAccountType: ConfigAccountType

  stats: PoolHistoryStats
  /** Whether this history is provably complete. See `findReserveGaps`. */
  integrity: HistoryIntegrity
  trades: RealTrade[]
}

/** Decoded on-chain accounts plus the bytes they came from. */
interface PoolContext {
  state: DbcPoolState
  config: Record<string, unknown>
  poolAccountType: PoolAccountType
  configAccountType: ConfigAccountType
  poolBase64: string
  configBase64: string
}

/** SPL mint layout: decimals is a single byte at offset 44. */
function mintDecimals(data: Buffer): number {
  if (data.length < 45) throw new Error('mint account too short')
  return data[44]
}

function bn(v: unknown): BN {
  return v as BN
}

/** Fetch and decode the pool and its config, handling both account variants. */
export async function fetchPoolContext(
  rpc: SolanaRpc,
  poolAddress: string,
): Promise<PoolContext> {
  const poolAcc = await rpc.getAccount(poolAddress)
  if (!poolAcc) throw new Error(`pool account not found: ${poolAddress}`)
  const poolBase64 = poolAcc.data[0]
  const pool = decodePoolBase64(poolBase64)
  if (!pool) throw new Error(`not a DBC pool account: ${poolAddress}`)

  const configAddress = String(pool.state.config)
  const configAcc = await rpc.getAccount(configAddress)
  if (!configAcc) throw new Error(`config account not found: ${configAddress}`)
  const configBase64 = configAcc.data[0]
  const config = decodeConfigBase64(configBase64)
  if (!config) throw new Error(`not a DBC config account: ${configAddress}`)

  return {
    state: pool.state,
    config: config.config as unknown as Record<string, unknown>,
    poolAccountType: pool.accountType,
    configAccountType: config.accountType,
    poolBase64,
    configBase64,
  }
}

export interface ReserveGap {
  /** Index of the last good trade before the gap. -1 means before the first trade. */
  afterTrade: number
  /** Quote lamports the chain accounts for that the recorded trades do not. */
  unexplainedQuote: string
  /** Signature bounding the gap on the left, null at the start of the pool. */
  fromSignature: string | null
  /** Signature of the first trade after the gap. */
  toSignature: string
}

export interface HistoryIntegrity {
  /** True when every trade's reserve follows from the one before it. */
  continuous: boolean
  gaps: ReserveGap[]
  /** Requests the endpoint never answered. Non-zero means possible data loss. */
  unansweredRequests: number
  /** Re-reads of the signature list spent closing gaps. */
  repairRounds: number
}

/**
 * How one trade moves the pool's quote reserve.
 *
 * Both rules are read off the chain rather than assumed.
 * `excludedFeeInputAmount` is the part of a buy that actually reaches the
 * curve, so it is what the reserve gains. On a sell the program pays the
 * trader `outputAmount` net of fees but removes the gross amount from the
 * reserve, so the fees have to be added back. Neither depends on
 * `collectFeeMode`, which only decides the token a fee is denominated in.
 */
export function quoteReserveDelta(t: RealTrade): BN {
  if (t.side === 'buy') return new BN(t.amountExcludedFee)
  return new BN(t.amountOut).add(new BN(t.tradingFee)).add(new BN(t.protocolFee)).neg()
}

/**
 * Find places where the recorded trades fail to account for the pool's reserve.
 *
 * Every `EvtSwap2` carries the pool's quote reserve immediately after that
 * swap, straight from the program. That makes a trade list self-checking: if
 * applying trade i's delta to trade i-1's reserve does not land on trade i's
 * own recorded reserve, a swap between the two is missing. No external
 * reference is needed, which is what lets the backfill prove its own
 * completeness rather than asking to be trusted.
 *
 * This matters because the default endpoint is a load-balanced pool of nodes
 * that will serve an incomplete signature list or drop a sub-response without
 * reporting an error. A missing trade is otherwise invisible: the history
 * still looks plausible, and every downstream replay is quietly wrong.
 */
export function findReserveGaps(trades: RealTrade[]): ReserveGap[] {
  const gaps: ReserveGap[] = []
  let running = new BN(0)
  for (let i = 0; i < trades.length; i++) {
    const expected = running.add(quoteReserveDelta(trades[i]))
    const actual = new BN(trades[i].quoteReserveAfter)
    if (!expected.eq(actual)) {
      gaps.push({
        afterTrade: i - 1,
        unexplainedQuote: actual.sub(expected).toString(),
        fromSignature: i > 0 ? trades[i - 1].signature : null,
        toSignature: trades[i].signature,
      })
    }
    // Resync to what the chain reported so one gap does not cascade into a
    // mismatch on every trade that follows it.
    running = actual
  }
  return gaps
}

/** Largest same-slot group to resolve by exhaustive search (7! = 5040). */
const MAX_PERMUTABLE_GROUP = 7

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield items
    return
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const p of permutations(rest)) yield [items[i], ...p]
  }
}

/**
 * Recover the execution order of trades that landed in the same slot.
 *
 * `getSignaturesForAddress` orders by slot but exposes no position within a
 * block, so trades sharing a slot can be assembled in the wrong order. The
 * reserve each swap reports is enough to recover the true order, because only
 * one ordering of a slot's trades chains correctly from the reserve before it.
 * Groups past the cap are left alone rather than searched exhaustively; the
 * integrity check reports them if they are wrong.
 */
export function reorderWithinSlots(trades: RealTrade[]): RealTrade[] {
  const out: RealTrade[] = []
  let running = new BN(0)

  for (let i = 0; i < trades.length; ) {
    let j = i
    while (j < trades.length && trades[j].slot === trades[i].slot) j++
    const group = trades.slice(i, j)

    const chains = (order: RealTrade[]): boolean => {
      let r = running
      for (const t of order) {
        r = r.add(quoteReserveDelta(t))
        if (!r.eq(new BN(t.quoteReserveAfter))) return false
      }
      return true
    }

    let chosen = group
    if (group.length > 1 && group.length <= MAX_PERMUTABLE_GROUP && !chains(group)) {
      for (const candidate of permutations(group)) {
        if (chains(candidate)) {
          chosen = candidate
          break
        }
      }
    }

    out.push(...chosen)
    running = new BN(chosen[chosen.length - 1].quoteReserveAfter)
    i = j
  }
  return out
}

export interface BackfillOptions {
  /** Cap on signature pages, as a guard against an unexpectedly huge pool. */
  maxPages?: number
  /**
   * How many times to re-read the signature list trying to close gaps before
   * giving up and reporting the history as discontinuous.
   */
  maxRepairRounds?: number
  onProgress?: (phase: string, done: number, total: number) => void
}

/**
 * Pull the complete trade history of one DBC pool from mainnet.
 *
 * The result is self-contained: it carries the raw config bytes alongside the
 * trades, so a replay or a test can run with no network access at all.
 *
 * Completeness is verified rather than assumed. After assembling the trades
 * this walks the reserve chain the program itself recorded, and any break in
 * it means a swap was missed. Re-reading the signature list usually lands on a
 * different node in the public endpoint's pool and returns the entries the
 * first read omitted, so gaps are retried before the history is accepted.
 * Whatever remains is reported in `integrity` rather than hidden: a fixture
 * that quietly drops trades makes every downstream replay wrong while still
 * looking entirely plausible.
 *
 * Failed transactions are counted but never fetched. On a contested launch
 * they are the majority of all signatures and none of them moved the curve,
 * so skipping them removes most of the RPC cost without losing any state.
 */
export async function backfillPool(
  rpc: SolanaRpc,
  poolAddress: string,
  opts: BackfillOptions = {},
): Promise<PoolHistory> {
  const report = opts.onProgress ?? (() => {})
  const maxRepairRounds = opts.maxRepairRounds ?? 3

  report('accounts', 0, 1)
  const ctx = await fetchPoolContext(rpc, poolAddress)
  const { state, config } = ctx

  const quoteMint = String(config.quoteMint)
  const quoteMintAcc = await rpc.getAccount(quoteMint)
  if (!quoteMintAcc) throw new Error(`quote mint not found: ${quoteMint}`)
  const tokenQuoteDecimal = mintDecimals(Buffer.from(quoteMintAcc.data[0], 'base64'))
  report('accounts', 1, 1)

  // Signature -> the swaps it held for this pool. Caching by signature is what
  // makes a repair round cheap: it only fetches what it has not already seen.
  const swapsBySignature = new Map<string, RealTrade[]>()
  const known = new Map<string, SignatureInfo>()
  const seq = new Map<string, number>()
  let unansweredRequests = 0

  /** Read the signature list and merge it in. Returns how many were new. */
  const readSignatures = async (): Promise<number> => {
    const page = await rpc.getAllSignatures(poolAddress, {
      maxPages: opts.maxPages ?? 50,
      onPage: (total) => report('signatures', total, total),
    })
    // The list is newest-first; reversing gives chronological order and a
    // stable tie-breaker for trades that share a slot.
    const chronological = [...page].reverse()
    let added = 0
    for (let i = 0; i < chronological.length; i++) {
      const s = chronological[i]
      if (!known.has(s.signature)) added++
      known.set(s.signature, s)
      seq.set(s.signature, i)
    }
    return added
  }

  const pending = () =>
    [...known.values()].filter((s) => !s.err && !swapsBySignature.has(s.signature))

  const fetchPending = async () => {
    const todo = pending()
    if (!todo.length) return
    const txs = await rpc.getTransactions(
      todo.map((s) => s.signature),
      (done, total) => report('transactions', done, total),
    )
    unansweredRequests += rpc.lastUnanswered
    for (let i = 0; i < todo.length; i++) {
      const tx = txs[i]
      // A null is either a pruned transaction or one the endpoint declined to
      // answer, and the two are indistinguishable here. Leaving it uncached
      // means a later round retries it rather than recording "no swap here".
      if (tx === null) continue
      swapsBySignature.set(
        todo[i].signature,
        extractSwaps(tx, poolAddress).map((swap) => toRealTrade(swap, todo[i])),
      )
    }
  }

  const assemble = (): RealTrade[] => {
    const ordered = [...known.values()]
      .filter((s) => !s.err)
      .sort((a, b) => a.slot - b.slot || (seq.get(a.signature) ?? 0) - (seq.get(b.signature) ?? 0))
    const out: RealTrade[] = []
    for (const s of ordered) out.push(...(swapsBySignature.get(s.signature) ?? []))
    return reorderWithinSlots(out)
  }

  await readSignatures()
  await fetchPending()
  let trades = assemble()
  let gaps = findReserveGaps(trades)
  let repairRounds = 0

  while (gaps.length && repairRounds < maxRepairRounds) {
    repairRounds++
    report('repair', repairRounds, maxRepairRounds)
    const added = await readSignatures()
    // Nothing new to read and nothing left unfetched means another pass would
    // issue identical requests and get an identical answer.
    if (added === 0 && pending().length === 0) break
    await fetchPending()
    trades = assemble()
    gaps = findReserveGaps(trades)
  }

  const allSignatures = [...known.values()]
  const failedTransactions = allSignatures.filter((s) => s.err).length

  const migrationQuoteThreshold = bn(config.migrationQuoteThreshold)
  let graduatedAtTrade: number | null = null
  for (let i = 0; i < trades.length; i++) {
    if (new BN(trades[i].quoteReserveAfter).gte(migrationQuoteThreshold)) {
      graduatedAtTrade = i + 1
      break
    }
  }

  const firstBlockTime = trades.length ? trades[0].blockTime : null
  const lastBlockTime = trades.length ? trades[trades.length - 1].blockTime : null

  const tokenBaseDecimal = Number(config.tokenDecimal)
  const totalTokenSupply = bn(config.preMigrationTokenSupply)
  const curve = config.curve as { sqrtPrice: BN; liquidity: BN }[]

  return {
    schema: POOL_HISTORY_SCHEMA,
    fetchedAt: new Date().toISOString(),
    rpcHost: rpc.host,

    pool: poolAddress,
    config: String(state.config),
    baseMint: String(state.baseMint),
    quoteMint,
    creator: String(state.creator),

    tokenBaseDecimal,
    tokenQuoteDecimal,
    totalTokenSupply: totalTokenSupply.toString(),
    totalTokenSupplyUi: Number(totalTokenSupply.toString()) / 10 ** tokenBaseDecimal,

    sqrtStartPrice: bn(config.sqrtStartPrice).toString(),
    migrationQuoteThreshold: migrationQuoteThreshold.toString(),
    migrationSqrtPrice: bn(config.migrationSqrtPrice).toString(),
    collectFeeMode: Number(config.collectFeeMode),
    baseFeeBps: cliffFeeBps(config),
    creatorTradingFeePercentage: Number(config.creatorTradingFeePercentage),
    curvePoints: curve.filter((p) => !p.liquidity.isZero()).length,
    isMigrated: Number(state.isMigrated) === 1,

    configAccountBase64: ctx.configBase64,
    poolAccountBase64: ctx.poolBase64,
    poolAccountType: ctx.poolAccountType,
    configAccountType: ctx.configAccountType,

    stats: {
      signaturesScanned: allSignatures.length,
      failedTransactions,
      swaps: trades.length,
      buys: trades.filter((t) => t.side === 'buy').length,
      sells: trades.filter((t) => t.side === 'sell').length,
      firstBlockTime,
      lastBlockTime,
      lifetimeSeconds:
        firstBlockTime !== null && lastBlockTime !== null ? lastBlockTime - firstBlockTime : null,
      graduatedAtTrade,
    },
    integrity: {
      continuous: gaps.length === 0,
      gaps,
      unansweredRequests,
      repairRounds,
    },
    trades,
  }
}

function toRealTrade(swap: Swap2Event, meta: SignatureInfo): RealTrade {
  const r = swap.swapResult
  const amountIn = bn(r.includedFeeInputAmount)
  const amountLeft = bn(r.amountLeft)
  return {
    signature: meta.signature,
    slot: meta.slot,
    blockTime: meta.blockTime,
    side: swap.tradeDirection === TRADE_DIRECTION.quoteToBase ? 'buy' : 'sell',
    amountIn: amountIn.toString(),
    amountFilled: amountIn.sub(amountLeft).toString(),
    amountExcludedFee: bn(r.excludedFeeInputAmount).toString(),
    amountLeft: amountLeft.toString(),
    amountOut: bn(r.outputAmount).toString(),
    tradingFee: bn(r.tradingFee).toString(),
    protocolFee: bn(r.protocolFee).toString(),
    nextSqrtPrice: bn(r.nextSqrtPrice).toString(),
    quoteReserveAfter: bn(swap.quoteReserveAmount).toString(),
  }
}

/** Base fee in basis points, from the config fee numerator. */
function cliffFeeBps(config: Record<string, unknown>): number {
  const poolFees = config.poolFees as { baseFee: { cliffFeeNumerator: BN } }
  const numerator = Number(poolFees.baseFee.cliffFeeNumerator.toString())
  return (numerator / FEE_DENOMINATOR) * 10_000
}
