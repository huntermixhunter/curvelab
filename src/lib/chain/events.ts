import bs58 from 'bs58'
import type BN from 'bn.js'
import { DBC_PROGRAM_ID, EVENT_CPI_DISCRIMINATOR, dbcCoder } from './program'
import type { RpcTransaction } from './rpc'

/**
 * Event names as Anchor exposes them once the IDL has been camelCased.
 *
 * The raw IDL calls these `EvtSwap2` / `EvtCurveComplete`; constructing a
 * `Program` lowercases the leading character. Using the wrong casing does not
 * throw, it simply matches nothing, so these are centralised here.
 */
export const DBC_EVENT = {
  swap: 'evtSwap',
  swap2: 'evtSwap2',
  swap2WithTransferHook: 'evtSwap2WithTransferHook',
  curveComplete: 'evtCurveComplete',
  initializePool: 'evtInitializePool',
} as const

export interface DecodedEvent {
  name: string
  data: Record<string, unknown>
}

/** `EvtSwap2`, the richest swap event the program emits. */
export interface Swap2Event {
  pool: string
  config: string
  /** 0 = BaseToQuote (a sell), 1 = QuoteToBase (a buy). */
  tradeDirection: number
  hasReferral: boolean
  swapParameters: { amount0: BN; amount1: BN; swapMode: number }
  swapResult: {
    includedFeeInputAmount: BN
    excludedFeeInputAmount: BN
    amountLeft: BN
    outputAmount: BN
    nextSqrtPrice: BN
    tradingFee: BN
    protocolFee: BN
    referralFee: BN
  }
  /** Pool quote reserve after this trade, straight from the program. */
  quoteReserveAmount: BN
  migrationThreshold: BN
  currentTimestamp: BN
}

/** `TradeDirection` as the program encodes it. */
export const TRADE_DIRECTION = { baseToQuote: 0, quoteToBase: 1 } as const

/**
 * Full account key list for a transaction, in instruction-index order.
 *
 * Versioned transactions resolve part of their key list from address lookup
 * tables, and the RPC returns those separately in `meta.loadedAddresses`. The
 * on-chain ordering is static keys, then LUT writable, then LUT readonly;
 * getting this wrong silently misidentifies which program an inner instruction
 * belongs to.
 */
function accountKeys(tx: RpcTransaction): string[] {
  return [
    ...(tx.transaction.message.accountKeys ?? []),
    ...(tx.meta?.loadedAddresses?.writable ?? []),
    ...(tx.meta?.loadedAddresses?.readonly ?? []),
  ]
}

/**
 * Decode every DBC event emitted by a transaction, in emission order.
 *
 * DBC uses Anchor `emit_cpi!`, so events are not `Program data:` log lines and
 * Anchor's own `EventParser` returns nothing for these transactions. Each event
 * is instead a self-CPI whose instruction data is the CPI marker followed by a
 * standard Anchor event payload.
 */
export function decodeDbcEvents(tx: RpcTransaction | null): DecodedEvent[] {
  if (!tx?.meta || tx.meta.err) return []
  const keys = accountKeys(tx)
  const coder = dbcCoder()
  const events: DecodedEvent[] = []

  for (const group of tx.meta.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      if (keys[ix.programIdIndex] !== DBC_PROGRAM_ID) continue

      let raw: Buffer
      try {
        raw = Buffer.from(bs58.decode(ix.data))
      } catch {
        continue
      }
      if (raw.length < 16) continue
      if (!raw.subarray(0, 8).equals(EVENT_CPI_DISCRIMINATOR)) continue

      const decoded = coder.events.decode(raw.subarray(8).toString('base64'))
      if (decoded) {
        events.push({ name: decoded.name, data: decoded.data as Record<string, unknown> })
      }
    }
  }
  return events
}

/** Swap events for one pool, in emission order. */
export function extractSwaps(tx: RpcTransaction | null, pool: string): Swap2Event[] {
  const out: Swap2Event[] = []
  for (const e of decodeDbcEvents(tx)) {
    // Every swap emits both EvtSwap and EvtSwap2. Only EvtSwap2 carries
    // amountLeft and the running quote reserve, so EvtSwap is ignored to avoid
    // counting each trade twice.
    if (e.name !== DBC_EVENT.swap2 && e.name !== DBC_EVENT.swap2WithTransferHook) continue
    const data = e.data as unknown as Swap2Event
    if (String(data.pool) !== pool) continue
    out.push(data)
  }
  return out
}

/** True if the transaction contains a graduation event for this pool. */
export function hasCurveComplete(tx: RpcTransaction | null, pool: string): boolean {
  return decodeDbcEvents(tx).some(
    (e) => e.name === DBC_EVENT.curveComplete && String(e.data.pool) === pool,
  )
}

/** Distinct pool addresses that traded in a transaction. Used by discovery. */
export function poolsTouched(tx: RpcTransaction | null): string[] {
  const seen = new Set<string>()
  for (const e of decodeDbcEvents(tx)) {
    if (e.name === DBC_EVENT.swap2 || e.name === DBC_EVENT.swap2WithTransferHook) {
      seen.add(String(e.data.pool))
    }
  }
  return [...seen]
}
