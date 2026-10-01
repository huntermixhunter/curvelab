import type BN from 'bn.js'
import type { PoolConfig } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { dbcCoder } from './program'

/**
 * The pool state the program actually maintains.
 *
 * Note the indirection: a `VirtualPool` account holds exactly one field,
 * `poolState`, and every interesting value lives inside it. Reading
 * `pool.quoteReserve` off the decoded account returns `undefined` rather than
 * throwing, so this is a mistake that survives a long way before it surfaces.
 */
export interface DbcPoolState {
  config: unknown
  creator: unknown
  baseMint: unknown
  baseVault: unknown
  quoteVault: unknown
  baseReserve: BN
  quoteReserve: BN
  sqrtPrice: BN
  activationPoint: BN
  isMigrated: number
  migrationProgress: number
  finishCurveTimestamp: BN
  [key: string]: unknown
}

export type PoolAccountType = 'virtualPool' | 'transferHookPool'
export type ConfigAccountType = 'poolConfig' | 'configWithTransferHook'

export interface DecodedPool {
  state: DbcPoolState
  accountType: PoolAccountType
}

export interface DecodedConfig {
  config: PoolConfig
  accountType: ConfigAccountType
  /** Present only for Token-2022 pools that route through a transfer hook. */
  transferHookProgram?: string
}

function tryDecode<T>(name: string, data: Buffer): T | null {
  try {
    return dbcCoder().accounts.decode(name, data) as T
  } catch {
    return null
  }
}

/**
 * Decode a DBC pool account of either variant.
 *
 * Token-2022 tokens with a transfer hook are stored as `transferHookPool`, a
 * distinct account type with its own discriminator but the same inner
 * `poolState`. These are a real and growing share of launches, and a decoder
 * that only knows `virtualPool` drops every one of them with nothing worse
 * than an "invalid account discriminator" it is tempting to treat as noise.
 */
export function decodePoolAccount(data: Buffer): DecodedPool | null {
  for (const accountType of ['virtualPool', 'transferHookPool'] as PoolAccountType[]) {
    const decoded = tryDecode<{ poolState: DbcPoolState }>(accountType, data)
    if (decoded?.poolState) return { state: decoded.poolState, accountType }
  }
  return null
}

/**
 * Decode a DBC config account of either variant.
 *
 * `ConfigWithTransferHook` wraps an ordinary `PoolConfig` alongside the hook
 * program id, so unwrapping it yields a config the quote math can price
 * unchanged.
 */
export function decodeConfigAccount(data: Buffer): DecodedConfig | null {
  const plain = tryDecode<PoolConfig>('poolConfig', data)
  if (plain) return { config: plain, accountType: 'poolConfig' }

  const wrapped = tryDecode<{ config: PoolConfig; transferHookProgram: unknown }>(
    'configWithTransferHook',
    data,
  )
  if (wrapped?.config) {
    return {
      config: wrapped.config,
      accountType: 'configWithTransferHook',
      transferHookProgram: String(wrapped.transferHookProgram),
    }
  }
  return null
}

/** Decode from a base64 account payload, as returned by the RPC. */
export const decodePoolBase64 = (b64: string) => decodePoolAccount(Buffer.from(b64, 'base64'))
export const decodeConfigBase64 = (b64: string) => decodeConfigAccount(Buffer.from(b64, 'base64'))
