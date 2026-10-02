/** Refresh the demo's portable inputs and measured evidence, entirely offline. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PoolHistory } from '../src/lib/chain/backfill'
import { verifyAgainstChain } from '../src/lib/dbc/replay'
import { comparisonIssue, summarise } from '../src/lib/server/corpus'
import { runSimulation } from '../src/lib/server/simulate-service'
import { exportPreset, parsePreset, STARTER_PRESETS } from '../src/lib/presets/catalog'
import type { CurveOutcome } from '../src/lib/api/types'

const destination = join('docs', 'demo')
const fixtureDirectory = join('data', 'pools')
const demoPool = '7CSnmLkKq4XD1DRZW3FuLbS6xebpaDtg6j3zjzzkwt6U'
const files = readdirSync(fixtureDirectory).filter((f) => f.endsWith('.json')).sort()
if (!files.length) throw new Error('The demo requires stored mainnet fixtures.')

const histories = files.map((file) => {
  const bytes = readFileSync(join(fixtureDirectory, file))
  const history = JSON.parse(bytes.toString('utf8')) as PoolHistory
  const verdict = verifyAgainstChain(history)
  if (!history.integrity?.continuous || !history.trades.length || !verdict.exact || verdict.dynamicFeeEnabled) {
    throw new Error(`Cannot publish demo evidence for an unverified fixture: ${file}`)
  }
  return { history, evidence: {
    file: `data/pools/${file}`, pool: history.pool,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    swaps: verdict.trades, matched: verdict.matched,
    comparisonIssue: comparisonIssue(history),
  } }
})

const reference = histories.find(({ history }) => history.pool === demoPool)
if (!reference || reference.evidence.comparisonIssue) {
  throw new Error('The documented reference launch is missing or unsupported. Do not silently change the demo.')
}
const pool = summarise(reference.history)
const preset = parsePreset({
  format: 'curvelab-preset', version: 1, id: 'demo-mainnet-graduation-v1',
  name: 'One launch, two graduation targets',
  description: 'Replay the same 245 recorded buys against half and double the original migration target. The original curve is added as the baseline.',
  useCase: 'Explore DBC migration timing using a verified mainnet buy flow.',
  createdAt: '2026-10-02T00:00:00.000Z',
  simulation: {
    demand: { kind: 'pool', pool: demoPool },
    curves: [0.5, 2].map((factor, slot) => ({
      id: `demo-${slot}`, slot, label: slot === 0 ? 'Graduate sooner' : 'Graduate later',
      curve: {
        migrationThresholdQuote: pool.curve.migrationThresholdQuote * factor,
        curveLength: pool.curve.curveLength,
        baseFeeBps: pool.curve.baseFeeBps,
        creatorTradingFeePercentage: 0,
        totalTokenSupply: pool.curve.totalTokenSupply,
      },
    })),
  },
})
const result = runSimulation(preset.simulation)
if (!result.baseline) throw new Error('Reference launch baseline was not simulated.')
const outcomes = [result.curves[0], result.baseline, result.curves[1]]
for (const outcome of outcomes) {
  if (outcome.error) throw new Error(outcome.error)
  const accounted = outcome.quoteThroughCurve + outcome.quoteUnfilled + outcome.quoteStranded
  if (Math.abs(accounted - result.demand.totalQuote) > 1e-7) {
    throw new Error(`Demand accounting failed for ${outcome.label}.`)
  }
}
const metrics = (outcome: CurveOutcome) => ({
  label: outcome.label, migrationThresholdQuote: outcome.migrationThresholdQuote,
  graduatedAtTrade: outcome.graduatedAtTrade, quoteThroughCurve: outcome.quoteThroughCurve,
  quoteUnfilled: outcome.quoteUnfilled, quoteStranded: outcome.quoteStranded,
  tradingFee: outcome.tradingFee, initialMarketCap: outcome.initialMarketCap,
  finalMarketCap: outcome.finalMarketCap,
})
const evidence = {
  generatedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
  fixtures: histories.map(({ evidence: fixture }) => fixture),
  verifiedPools: histories.length,
  verifiedSwaps: histories.reduce((total, { evidence: fixture }) => total + fixture.swaps, 0),
  uiEligiblePools: histories.filter(({ evidence: fixture }) => !fixture.comparisonIssue).length,
  reference: { pool: demoPool, demand: result.demand, onChain: result.baseline.onChain },
  comparison: outcomes.map(metrics),
  boundaries: [
    'Counterfactuals hold recorded buys fixed and omit sells on every curve.',
    'Designed alternatives use the standard builder allocation; they do not clone the original vesting or liquidity allocation.',
    'Only the stored on-chain replay includes both buys and sells.',
    'Combined partner and creator DBC fees are valued at each execution rate; base-token fees are not SOL cash payouts.',
    'Post-migration DAMM fees, dynamic fees, trader reactions, and tokenized-equity data are not modeled.',
  ],
}

// All verification completes before writing any deliverable.
mkdirSync(destination, { recursive: true })
writeFileSync(join(destination, 'mainnet-graduation.curvelab.json'), exportPreset(preset))
for (const starter of STARTER_PRESETS) {
  writeFileSync(join(destination, `${starter.id}.curvelab.json`), exportPreset(starter))
}
writeFileSync(join(destination, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify({
  verifiedPools: evidence.verifiedPools, verifiedSwaps: evidence.verifiedSwaps,
  uiEligiblePools: evidence.uiEligiblePools, comparison: evidence.comparison,
}, null, 2))
