/**
 * Pull real Meteora DBC pool history off Solana mainnet.
 *
 *   node scripts/backfill.mts discover [--sample 400] [--graduated] [--limit 10]
 *   node scripts/backfill.mts fetch <poolAddress> [--out data/pools]
 *
 * Uses the free public RPC by default, which needs no key and no account.
 * Set SOLANA_RPC_URL to point at a private endpoint instead.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { SolanaRpc } from '../src/lib/chain/rpc'
import { discoverPools } from '../src/lib/chain/discover'
import { backfillPool } from '../src/lib/chain/backfill'

const argv = process.argv.slice(2)
const command = argv[0]

function flag(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const has = (name: string) => argv.includes(`--${name}`)

/** Single-line progress that does not spam a log file. */
function progress(phase: string, done: number, total: number) {
  const pct = total ? Math.round((done / total) * 100) : 0
  process.stdout.write(`\r  ${phase.padEnd(14)} ${String(done).padStart(5)}/${total} (${pct}%)   `)
  if (done >= total) process.stdout.write('\n')
}

const rpc = new SolanaRpc()

if (command === 'discover') {
  const sampleSize = Number(flag('sample', '400'))
  console.log(`Sampling ${sampleSize} recent DBC transactions via ${rpc.host}\n`)

  const pools = await discoverPools(rpc, {
    sampleSize,
    graduatedOnly: has('graduated'),
    limit: Number(flag('limit', '12')),
    onProgress: progress,
  })

  if (!pools.length) {
    console.log('\nNo pools found in the sample. Try a larger --sample.')
    process.exit(0)
  }

  console.log('\npool                                          swaps  progress  graduated')
  console.log('-'.repeat(78))
  for (const p of pools) {
    console.log(
      p.pool.padEnd(45) +
        String(p.swapsInSample).padStart(5) +
        `${(p.progress * 100).toFixed(1)}%`.padStart(10) +
        (p.graduated ? '  yes' : '  no'),
    )
  }
  console.log('\nBackfill one with:\n  node scripts/backfill.mts fetch <pool>')
} else if (command === 'fetch') {
  const pool = argv[1]
  if (!pool || pool.startsWith('--')) {
    console.error('Usage: node scripts/backfill.mts fetch <poolAddress>')
    process.exit(1)
  }
  const outDir = flag('out', join('data', 'pools'))!

  console.log(`Backfilling ${pool} via ${rpc.host}\n`)
  const started = Date.now()
  const history = await backfillPool(rpc, pool, { onProgress: progress })

  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${pool}.json`)
  writeFileSync(outPath, JSON.stringify(history, null, 2))

  const s = history.stats
  const sol = (lamports: string) => (Number(lamports) / 10 ** history.tokenQuoteDecimal).toFixed(3)

  console.log(`\nbase mint          ${history.baseMint}`)
  console.log(`quote              ${history.quoteMint}`)
  console.log(`curve              ${history.curvePoints} segments, ${history.baseFeeBps} bps base fee`)
  console.log(`migration target   ${sol(history.migrationQuoteThreshold)} SOL`)
  console.log(`signatures         ${s.signaturesScanned} (${s.failedTransactions} failed)`)
  console.log(`swaps              ${s.swaps} (${s.buys} buys, ${s.sells} sells)`)
  console.log(`graduated          ${s.graduatedAtTrade ? `yes, at trade #${s.graduatedAtTrade}` : 'no'}`)
  console.log(`lifetime           ${s.lifetimeSeconds ?? '?'}s`)

  const g = history.integrity
  if (g.continuous) {
    console.log(
      `integrity          complete, reserve chain verified across all ${s.swaps} swaps` +
        (g.repairRounds ? ` (after ${g.repairRounds} repair round(s))` : ''),
    )
  } else {
    console.log(`integrity          INCOMPLETE, ${g.gaps.length} gap(s) after ${g.repairRounds} repair round(s)`)
    for (const gap of g.gaps.slice(0, 5)) {
      console.log(`   missing ${sol(gap.unexplainedQuote)} SOL between trade #${gap.afterTrade} and #${gap.afterTrade + 1}`)
      console.log(`   ${gap.fromSignature ?? '(pool start)'} -> ${gap.toSignature}`)
    }
    if (g.gaps.length > 5) console.log(`   ... ${g.gaps.length - 5} more`)
    console.log('   This history is not safe to replay. Retry, or set SOLANA_RPC_URL')
    console.log('   to a private endpoint that serves a complete signature index.')
  }
  if (g.unansweredRequests) {
    console.log(`   note: ${g.unansweredRequests} request(s) went unanswered by the endpoint`)
  }
  console.log(`\nWrote ${outPath} in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  console.log(`Verify with:\n  node scripts/verify.mts ${outPath}`)
} else {
  console.log(
    [
      'Curve Lab mainnet backfill',
      '',
      '  node scripts/backfill.mts discover [--sample 400] [--graduated] [--limit 12]',
      '      Find live DBC pools from the program transaction stream.',
      '',
      '  node scripts/backfill.mts fetch <poolAddress> [--out data/pools]',
      '      Pull the full trade history of one pool into a replayable fixture.',
      '',
      `  RPC: ${rpc.host} (override with SOLANA_RPC_URL)`,
    ].join('\n'),
  )
  process.exit(command ? 1 : 0)
}
