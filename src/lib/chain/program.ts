import { Program, type AnchorProvider } from '@coral-xyz/anchor'
import { DynamicBondingCurveIdl } from '@meteora-ag/dynamic-bonding-curve-sdk'

/** Meteora Dynamic Bonding Curve, Solana mainnet. */
export const DBC_PROGRAM_ID = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'

/**
 * Anchor's `emit_cpi!` wrapper discriminator.
 *
 * DBC does not emit events as `Program data:` log lines, so Anchor's own
 * `EventParser` finds nothing. Instead each event is a self-CPI to the program
 * with the event authority as signer, and the instruction data is
 * `[this 8-byte marker][8-byte event discriminator][borsh payload]`.
 * Stripping the marker leaves exactly what `coder.events.decode` expects.
 */
export const EVENT_CPI_DISCRIMINATOR = Buffer.from([
  0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d,
])

let cached: Program | null = null

/**
 * A decode-only Anchor `Program` for the DBC IDL.
 *
 * `Program` is used rather than a bare `BorshCoder` for one specific reason:
 * its constructor runs the IDL through `convertIdlToCamelCase`, so accounts
 * decode to `sqrtStartPrice` / `poolFees` rather than the raw IDL's
 * `sqrt_start_price` / `pool_fees`. The SDK's quote functions read the camelCase
 * names, so a bare `BorshCoder` would decode successfully and then silently
 * price every swap against `undefined` fields.
 *
 * The provider is a stub: nothing here touches the network or signs anything,
 * but Anchor insists on one and falls back to reading `ANCHOR_WALLET` from the
 * environment when it is omitted.
 */
export function dbcProgram(): Program {
  if (!cached) {
    const offline = { connection: {} } as unknown as AnchorProvider
    cached = new Program(DynamicBondingCurveIdl, offline)
  }
  return cached
}

/** Account/event coders with camelCase field names. */
export function dbcCoder() {
  return dbcProgram().coder
}
