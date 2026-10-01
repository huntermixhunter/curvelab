/** One entry from `getSignaturesForAddress`. */
export interface SignatureInfo {
  signature: string
  slot: number
  blockTime: number | null
  err: unknown | null
}

/** The slice of a `getTransaction` response the backfill reads. */
export interface RpcTransaction {
  slot: number
  blockTime: number | null
  transaction: { message: { accountKeys: string[] } }
  meta: {
    err: unknown | null
    logMessages?: string[]
    innerInstructions?: {
      index: number
      instructions: { programIdIndex: number; data: string }[]
    }[]
    loadedAddresses?: { writable: string[]; readonly: string[] }
  } | null
}

export interface AccountInfo {
  data: [string, string]
  owner: string
  lamports: number
}

interface JsonRpcResponse<T> {
  id: number
  result?: T
  error?: { code: number; message: string }
}

export class RpcError extends Error {
  // Declared as plain fields rather than constructor parameter properties:
  // Node runs these .ts files by stripping types only, and a parameter
  // property needs a real code transform, so it fails to parse at runtime.
  readonly method: string
  readonly code: number | null

  constructor(method: string, code: number | null, message: string) {
    super(`${method}: ${message}`)
    this.name = 'RpcError'
    this.method = method
    this.code = code
  }
}

export interface SolanaRpcOptions {
  url?: string
  /** Requests per JSON-RPC batch. Public endpoints reject very large batches. */
  batchSize?: number
  maxRetries?: number
  /** Pause between batches. Public endpoints throttle around 10 requests/sec. */
  throttleMs?: number
}

/** JSON-RPC codes that mean "slow down" rather than "this request is wrong". */
const RETRYABLE_RPC_CODES = new Set([-32005, -32004, -32002])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * A small Solana JSON-RPC client.
 *
 * Deliberately not `@solana/web3.js`: the backfill needs four methods, and
 * web3.js would pull a large dependency tree into a Next.js bundle to provide
 * them. What this adds over bare `fetch` is the part that actually matters when
 * pulling several hundred transactions from a free public endpoint, namely
 * request batching and backoff on rate-limit responses.
 *
 * Batching is what makes a full pool history practical: a batch of 50
 * transactions returns in roughly the time of one serial request, turning a
 * multi-minute crawl into a few seconds.
 *
 * Set `SOLANA_RPC_URL` to use a private endpoint for more throughput or deeper
 * history. The default public endpoint needs no key and no account.
 */
export class SolanaRpc {
  readonly url: string
  private readonly batchSize: number
  private readonly maxRetries: number
  private readonly throttleMs: number

  /**
   * Grows when the endpoint pushes back, so a long backfill settles into a
   * sustainable rate instead of retrying into the same wall on every batch.
   */
  private extraThrottleMs = 0

  constructor(opts: SolanaRpcOptions = {}) {
    this.url =
      opts.url ?? process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
    // The public endpoint allows roughly 100 requests per 10 seconds per IP,
    // and counts a JSON-RPC batch as its constituent requests. 20 per batch
    // every 2s sits just under that. A private endpoint can go far faster.
    this.batchSize = opts.batchSize ?? 20
    this.maxRetries = opts.maxRetries ?? 8
    this.throttleMs = opts.throttleMs ?? 2000
  }

  /** Endpoint host. Safe to record in a fixture even when the URL carries a key. */
  get host(): string {
    try {
      return new URL(this.url).host
    } catch {
      return 'unknown'
    }
  }

  private async post(body: unknown): Promise<unknown> {
    let lastError: Error | null = null
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff with jitter, so parallel callers do not retry in lockstep.
        const base = Math.min(15_000, 500 * 2 ** (attempt - 1))
        await sleep(base * (0.5 + Math.random()))
      }
      let res: Response
      try {
        res = await fetch(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        })
      } catch (e) {
        lastError = e as Error
        continue
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = new RpcError('http', res.status, `HTTP ${res.status}`)
        if (res.status === 429) {
          // Back off everything that follows, not just this request.
          this.extraThrottleMs = Math.min(10_000, this.extraThrottleMs + 750)
          const retryAfter = Number(res.headers.get('retry-after'))
          if (Number.isFinite(retryAfter) && retryAfter > 0) await sleep(retryAfter * 1000)
        }
        continue
      }
      if (!res.ok) throw new RpcError('http', res.status, `HTTP ${res.status}`)
      return res.json()
    }
    throw lastError ?? new RpcError('http', null, 'exhausted retries')
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const body = (await this.post({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      })) as JsonRpcResponse<T>
      if (body.error) {
        if (RETRYABLE_RPC_CODES.has(body.error.code) && attempt < this.maxRetries) continue
        throw new RpcError(method, body.error.code, body.error.message)
      }
      return body.result as T
    }
    throw new RpcError(method, null, 'exhausted retries')
  }

  /**
   * Sub-requests from the last `batch` that never came back with any response.
   *
   * Zero means every request was answered, even if some answers were `null`.
   * Non-zero means the endpoint dropped requests and the caller is holding an
   * incomplete picture, which for a trade history is silent data loss.
   */
  lastUnanswered = 0

  /** One pass over a set of request indices, filling `out` and `answered`. */
  private async batchPass<T>(
    method: string,
    paramsList: unknown[][],
    indices: number[],
    out: (T | null)[],
    answered: boolean[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    for (let start = 0; start < indices.length; start += this.batchSize) {
      const chunk = indices.slice(start, start + this.batchSize)
      const body = chunk.map((idx) => ({
        jsonrpc: '2.0',
        id: idx,
        method,
        params: paramsList[idx],
      }))

      let responses: JsonRpcResponse<T>[] = []
      for (let attempt = 0; ; attempt++) {
        const raw = await this.post(body)
        if (!Array.isArray(raw)) {
          const err = (raw as JsonRpcResponse<T>)?.error
          if (err && RETRYABLE_RPC_CODES.has(err.code) && attempt < this.maxRetries) continue
          throw new RpcError(method, err?.code ?? null, err?.message ?? 'batch rejected')
        }
        responses = raw as JsonRpcResponse<T>[]
        const throttled = responses.some((r) => r.error && RETRYABLE_RPC_CODES.has(r.error.code))
        if (throttled && attempt < this.maxRetries) {
          await sleep(Math.min(8000, 500 * 2 ** attempt))
          continue
        }
        break
      }

      for (const r of responses) {
        if (r.error) continue
        out[r.id] = (r.result ?? null) as T | null
        answered[r.id] = true
      }
      onProgress?.(Math.min(start + chunk.length, indices.length), indices.length)
      if (start + this.batchSize < indices.length) {
        await sleep(this.throttleMs + this.extraThrottleMs)
      }
    }
  }

  /**
   * Run many same-method calls as JSON-RPC batches.
   *
   * Results come back positionally. Batching is what makes a full pool history
   * practical: a batch of 20 transactions returns in roughly the time of one
   * serial request, turning a multi-minute crawl into a few seconds.
   *
   * The sweep pass at the end is not an optimisation, it is a correctness
   * requirement. `api.mainnet-beta.solana.com` is a load-balanced pool of
   * nodes, and under load it will omit individual sub-responses from a batch
   * without flagging them as rate-limited. A dropped `getTransaction` is
   * indistinguishable from a transaction containing no swap, so without this
   * the caller silently loses trades and never learns it happened. Requests
   * that were answered with a genuine `null` are not retried; only ones that
   * were never answered at all.
   */
  async batch<T>(
    method: string,
    paramsList: unknown[][],
    onProgress?: (done: number, total: number) => void,
  ): Promise<(T | null)[]> {
    const out: (T | null)[] = new Array(paramsList.length).fill(null)
    const answered = new Array<boolean>(paramsList.length).fill(false)

    await this.batchPass(
      method,
      paramsList,
      paramsList.map((_, i) => i),
      out,
      answered,
      onProgress,
    )

    for (let round = 0; round < 4; round++) {
      const missing: number[] = []
      for (let i = 0; i < answered.length; i++) if (!answered[i]) missing.push(i)
      if (!missing.length) break
      await sleep(Math.min(8000, 1000 * 2 ** round))
      await this.batchPass(method, paramsList, missing, out, answered)
    }

    this.lastUnanswered = answered.reduce((n, a) => (a ? n : n + 1), 0)
    return out
  }

  /**
   * Every signature touching `address`, newest first.
   *
   * `getSignaturesForAddress` caps a page at 1000 and paginates with `before`,
   * so the full lifetime of a pool is a short walk backwards from its most
   * recent trade.
   */
  async getAllSignatures(
    address: string,
    opts: { maxPages?: number; onPage?: (total: number) => void } = {},
  ): Promise<SignatureInfo[]> {
    const maxPages = opts.maxPages ?? 50
    const all: SignatureInfo[] = []
    let before: string | undefined

    for (let page = 0; page < maxPages; page++) {
      const batch = await this.call<SignatureInfo[]>('getSignaturesForAddress', [
        address,
        { limit: 1000, ...(before ? { before } : {}) },
      ])
      if (!batch.length) break
      all.push(...batch)
      opts.onPage?.(all.length)
      if (batch.length < 1000) break
      before = batch[batch.length - 1].signature
      await sleep(this.throttleMs)
    }
    return all
  }

  async getTransactions(
    signatures: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<(RpcTransaction | null)[]> {
    return this.batch<RpcTransaction>(
      'getTransaction',
      signatures.map((s) => [s, { encoding: 'json', maxSupportedTransactionVersion: 0 }]),
      onProgress,
    )
  }

  async getAccount(address: string): Promise<AccountInfo | null> {
    const res = await this.call<{ value: AccountInfo | null }>('getAccountInfo', [
      address,
      { encoding: 'base64' },
    ])
    return res.value
  }
}
