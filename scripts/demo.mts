import BN from 'bn.js'
import { buildCurve } from '../src/lib/dbc/curve'
import { simulate } from '../src/lib/dbc/simulate'
import type { SimTrade } from '../src/lib/dbc/types'

const SUPPLY = 1_000_000_000
/** Lamports to whole SOL. Accepts a BN because every engine total is a u64. */
const sol = (n: BN | number) => Number(n.toString()) / 1e9

/** Compare three curve shapes against the same demand flow. */
const shapes = [
  { name: 'Tight  (30 -> 300 mcap)', initialMarketCap: 30, migrationMarketCap: 300 },
  { name: 'Normal (30 -> 600 mcap)', initialMarketCap: 30, migrationMarketCap: 600 },
  { name: 'Long   (30 -> 2000 mcap)', initialMarketCap: 30, migrationMarketCap: 2000 },
]

// Same demand profile for every curve: 120 buys of 1 SOL.
const trades: SimTrade[] = Array.from({ length: 120 }, () => ({
  side: 'buy' as const, quoteIn: new BN(1e9),
}))

console.log('Demand held constant at 120 x 1 SOL buys.\n')
console.log('curve                      graduated  threshold   creatorFee  finalMcap   demandLeftOver')
console.log('-'.repeat(92))

for (const s of shapes) {
  const cfg = buildCurve({
    totalTokenSupply: SUPPLY, baseFeeBps: 100,
    initialMarketCap: s.initialMarketCap, migrationMarketCap: s.migrationMarketCap,
  })
  const r = simulate({
    config: cfg, trades, tokenBaseDecimal: 6, tokenQuoteDecimal: 9, totalTokenSupply: SUPPLY,
  })
  const grad = r.graduatedAtTrade ? `#${r.graduatedAtTrade}`.padEnd(9) : 'no'.padEnd(9)
  console.log(
    s.name.padEnd(26) + grad +
    `${sol(cfg.migrationQuoteThreshold).toFixed(1)} SOL`.padEnd(12) +
    `${sol(r.totalTradingFee).toFixed(3)} SOL`.padEnd(12) +
    `${r.finalMarketCap.toFixed(0)} SOL`.padEnd(12) +
    `${sol(r.quoteDemandAfterGraduation).toFixed(0)} SOL`,
  )
}
