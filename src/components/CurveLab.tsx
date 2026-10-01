'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CurveInput, CurveOutcome, PoolSummary, SimulateRequest, SimulateResponse,
} from '@/lib/api/types'
import { DEMAND_SHAPES, type DemandShape } from '@/lib/dbc/demand'
import { duration, pct, seriesColor, shortAddress, sig, sol } from '@/lib/ui/format'
import { Panel, Segmented, Slider } from './Control'
import LineChart, { type ChartSeries } from './LineChart'
import CaptureBar from './CaptureBar'
import ComparisonTable from './ComparisonTable'

interface CurveState {
  id: string
  slot: number
  label: string
  curve: CurveInput
}

const MAX_CURVES = 3
const DEBOUNCE_MS = 180

/** Both headline views are indexed, so curves of any scale share one axis. */
type ChartView = 'progress' | 'multiple'

const CHART_VIEWS: { id: ChartView; label: string; detail: string }[] = [
  {
    id: 'progress',
    label: 'Fill to graduation',
    detail: 'Share of each curve’s own migration target that demand has filled.',
  },
  {
    id: 'multiple',
    label: 'Price multiple',
    detail: 'Market cap as a multiple of where that curve started.',
  },
]

const SYNTHETIC_SUPPLY = 1_000_000_000

const syntheticSeed = (): CurveState[] => [
  {
    id: 'a', slot: 0, label: 'Tight',
    curve: {
      migrationThresholdQuote: 40, curveLength: 10, baseFeeBps: 100,
      creatorTradingFeePercentage: 0, totalTokenSupply: SYNTHETIC_SUPPLY,
    },
  },
  {
    id: 'b', slot: 1, label: 'Standard',
    curve: {
      migrationThresholdQuote: 85, curveLength: 20, baseFeeBps: 100,
      creatorTradingFeePercentage: 0, totalTokenSupply: SYNTHETIC_SUPPLY,
    },
  },
]

/**
 * Seed a comparison from a real launch: the curve it used, halved and doubled.
 *
 * Seeding from the pool rather than from fixed defaults is what keeps the
 * first screen meaningful. A launch whose migration target was 11 SOL and one
 * whose target was 8,000 SOL need completely different curves before any
 * comparison says anything, and a fixed default is wrong for one of them.
 */
const poolSeed = (p: PoolSummary): CurveState[] => {
  const base: CurveInput = {
    migrationThresholdQuote: p.curve.migrationThresholdQuote,
    curveLength: p.curve.curveLength,
    baseFeeBps: p.curve.baseFeeBps,
    creatorTradingFeePercentage: 0,
    totalTokenSupply: p.curve.totalTokenSupply,
  }
  return [
    {
      id: 'a', slot: 0, label: 'Graduate sooner',
      curve: { ...base, migrationThresholdQuote: base.migrationThresholdQuote * 0.5 },
    },
    {
      id: 'b', slot: 1, label: 'Graduate later',
      curve: { ...base, migrationThresholdQuote: base.migrationThresholdQuote * 2 },
    },
  ]
}

export default function CurveLab({ pools }: { pools: PoolSummary[] }) {
  const [poolAddress, setPoolAddress] = useState<string | null>(pools[0]?.pool ?? null)
  const [useRealDemand, setUseRealDemand] = useState(pools.length > 0)
  const [shape, setShape] = useState<DemandShape>('frontloaded')
  const [buys, setBuys] = useState(120)
  const [totalQuote, setTotalQuote] = useState(120)
  const [supply, setSupply] = useState(pools[0]?.curve.totalTokenSupply ?? SYNTHETIC_SUPPLY)

  const pool = useMemo(
    () => pools.find((p) => p.pool === poolAddress) ?? null,
    [pools, poolAddress],
  )

  const [curves, setCurves] = useState<CurveState[]>(() =>
    pools[0] ? poolSeed(pools[0]) : syntheticSeed(),
  )
  const [chartView, setChartView] = useState<ChartView>('progress')
  const [result, setResult] = useState<SimulateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  /** Re-seed when the demand source changes: curve units follow the token. */
  const reseed = useCallback((next: PoolSummary | null) => {
    if (next) {
      setCurves(poolSeed(next))
      setSupply(next.curve.totalTokenSupply)
    } else {
      setCurves(syntheticSeed())
      setSupply(SYNTHETIC_SUPPLY)
    }
  }, [])

  const request: SimulateRequest = useMemo(
    () => ({
      curves: curves.map((c) => ({
        id: c.id,
        label: c.label,
        slot: c.slot,
        curve: { ...c.curve, totalTokenSupply: supply },
      })),
      demand:
        useRealDemand && pool
          ? { kind: 'pool', pool: pool.pool }
          : { kind: 'synthetic', shape, buys, totalQuote },
    }),
    [curves, supply, useRealDemand, pool, shape, buys, totalQuote],
  )

  // A slider drag fires a request per frame if unguarded. Debouncing bounds the
  // rate; the sequence number is what guarantees correctness, because a slow
  // early response must never overwrite a newer one that already landed.
  const sequence = useRef(0)
  useEffect(() => {
    const mine = ++sequence.current
    const controller = new AbortController()

    const timer = setTimeout(async () => {
      // Flagged pending here rather than in the effect body: a synchronous
      // setState in an effect cascades a render, and during the debounce
      // window nothing is in flight to report anyway.
      setPending(true)
      try {
        const res = await fetch('/api/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        })
        const body = await res.json()
        if (mine !== sequence.current) return
        if (!res.ok) {
          setResult(null)
          setError(body.error ?? `request failed (${res.status})`)
        } else {
          setResult(body as SimulateResponse)
          setError(null)
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError' && mine === sequence.current) {
          setResult(null)
          setError((e as Error).message)
        }
      } finally {
        if (mine === sequence.current) setPending(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [request])

  const update = (id: string, patch: Partial<CurveInput>) =>
    setCurves((cs) => cs.map((c) => (c.id === id ? { ...c, curve: { ...c.curve, ...patch } } : c)))

  const addCurve = () =>
    setCurves((cs) => {
      if (cs.length >= MAX_CURVES) return cs
      const slot = [0, 1, 2].find((s) => !cs.some((c) => c.slot === s)) ?? cs.length
      const from = cs[cs.length - 1]
      return [
        ...cs,
        {
          id: `curve-${Date.now().toString(36)}`,
          slot,
          label: `Curve ${cs.length + 1}`,
          curve: {
            ...from.curve,
            migrationThresholdQuote: from.curve.migrationThresholdQuote * 1.5,
          },
        },
      ]
    })

  const removeCurve = (id: string) =>
    setCurves((cs) => (cs.length > 1 ? cs.filter((c) => c.id !== id) : cs))

  // Memoised so the identity is stable: a fresh [] each render would
  // invalidate every downstream useMemo on every keystroke.
  const outcomes = useMemo(() => result?.curves ?? [], [result])
  const baseline = result?.baseline

  /**
   * Project every curve onto one y scale.
   *
   * Absolute market cap cannot be one of the options. How much base supply a
   * curve sells is part of its configuration, so two curves fed identical
   * demand can sit two orders of magnitude apart in market cap while behaving
   * almost identically: measured here, a designed curve ran 12 to 50 SOL
   * against a real pool's 447 to 500, and on a shared linear axis the designed
   * curves collapsed into the bottom tenth of the plot. Both views below are
   * indexed, so every line is on the same scale by construction.
   */
  const chartSeries = (view: ChartView | 'fee'): ChartSeries[] => {
    // Where each view sits before any trade has happened. Plotting it makes
    // the opening visible: on a real launch the first buy can take most of the
    // curve in one order, and without an origin that jump is simply missing
    // and the line appears to begin three quarters of the way up.
    const origin = view === 'multiple' ? 1 : 0

    const build = (c: CurveOutcome, reference: boolean): ChartSeries => ({
      id: c.id,
      label: c.label,
      color: reference ? 'var(--ink-muted)' : seriesColor(c.slot),
      reference,
      points: [
        { x: 0, y: origin },
        ...c.series.map((p) => ({
          x: p.t,
          y:
            view === 'fee'
              ? p.fee
              : view === 'multiple'
                ? c.initialMarketCap > 0
                  ? p.marketCap / c.initialMarketCap
                  : 0
                : c.migrationThresholdQuote > 0
                  ? (p.reserve / c.migrationThresholdQuote) * 100
                  : 0,
        })),
      ],
    })

    const rows = outcomes.filter((c) => c.series.length > 0).map((c) => build(c, false))
    if (baseline && baseline.series.length) rows.push(build(baseline, true))
    return rows
  }

  const verdict = useMemo(() => {
    const ok = outcomes.filter((c) => !c.error && c.series.length > 0)
    if (!ok.length) return null

    const best = ok.reduce((a, b) => (b.tradingFee > a.tradingFee ? b : a))
    const graduated = ok.filter((c) => c.graduatedAtTrade !== null)
    const earliest = graduated.length
      ? graduated.reduce((a, b) => (b.graduatedAtTrade! < a.graduatedAtTrade! ? b : a))
      : null

    const parts: string[] = []
    if (earliest && earliest.id !== best.id) {
      parts.push(
        `${earliest.label} graduates first, at trade #${earliest.graduatedAtTrade}, ` +
          `and gives up ${sol(best.tradingFee - earliest.tradingFee)} of fee to do it.`,
      )
    }
    if (best.quoteStranded > 0) {
      parts.push(
        `Even ${best.label} strands ${sol(best.quoteStranded)}, which arrived after it graduated ` +
          `and is outside this DBC simulation.`,
      )
    } else if (best.graduatedAtTrade === null) {
      parts.push(`${best.label} captures every order but never reaches its migration target.`)
    }

    const delta =
      baseline && baseline.tradingFee > 0
        ? (best.tradingFee - baseline.tradingFee) / baseline.tradingFee
        : null

    return { best, delta, sentence: parts.join(' ') }
  }, [outcomes, baseline])

  const demandTotal = result?.demand.totalQuote ?? 0

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-[var(--hairline)] py-5">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight text-ink">Curve Lab</h1>
          <p className="mt-0.5 max-w-xl text-[12px] leading-relaxed text-ink-secondary">
            Replay a Meteora Dynamic Bonding Curve against real mainnet demand before you launch on
            it. The curve math is Meteora&apos;s own SDK, verified swap for swap against the chain.
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-ink-muted">
          <span className="tnum">
            {pools.length} verified launch{pools.length === 1 ? '' : 'es'} available to compare
          </span>
          {result && <span className="tnum">{result.elapsedMs} ms</span>}
          <span
            aria-live="polite"
            className={`inline-block h-1.5 w-1.5 rounded-full transition-opacity duration-150 ${
              pending ? 'bg-[var(--status-warning)] opacity-100' : 'bg-[var(--status-good)] opacity-60'
            }`}
          >
            <span className="sr-only">{pending ? 'Simulating' : 'Up to date'}</span>
          </span>
        </div>
      </header>

      <div className="grid gap-5 pt-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <Panel title="Demand">
            <Segmented
              label="Source"
              value={useRealDemand ? 'real' : 'synthetic'}
              options={[
                { id: 'real', label: 'Real launch' },
                { id: 'synthetic', label: 'Designed' },
              ]}
              onChange={(v) => {
                const real = v === 'real'
                setUseRealDemand(real)
                reseed(real ? pool : null)
              }}
            />

            {useRealDemand ? (
              pool ? (
                <div className="pt-1">
                  <label
                    htmlFor="pool-select"
                    className="mb-1 block text-[11px] text-ink-secondary"
                  >
                    Mainnet launch
                  </label>
                  <select
                    id="pool-select"
                    value={pool.pool}
                    onChange={(e) => {
                      const next = pools.find((p) => p.pool === e.target.value) ?? null
                      setPoolAddress(e.target.value)
                      reseed(next)
                    }}
                    className="w-full cursor-pointer rounded border border-[var(--hairline)] bg-[var(--surface-raised)] px-2 py-1.5 text-[11px] text-ink"
                  >
                    {pools.map((p) => (
                      <option key={p.pool} value={p.pool}>
                        {shortAddress(p.pool)}: {p.buys} buys, {sig(p.buyDemandQuote)} SOL
                        {p.graduated ? ', graduated' : ''}
                      </option>
                    ))}
                  </select>

                  <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    <Stat label="Buy orders" value={String(pool.buys)} />
                    <Stat label="Buy demand" value={sol(pool.buyDemandQuote)} />
                    <Stat label="Sells dropped" value={String(pool.sells)} />
                    <Stat label="Lifetime" value={duration(pool.lifetimeSeconds)} />
                    <Stat label="Failed tx" value={String(pool.failedTransactions)} />
                    <Stat label="Supply" value={sig(pool.curve.totalTokenSupply)} />
                  </dl>
                  <p className="mt-2 text-[10px] leading-tight text-ink-muted">
                    Every trade verified against the reserve the program itself recorded. Sells are
                    dropped from both sides of the comparison.
                  </p>
                </div>
              ) : (
                <p className="py-2 text-[11px] text-ink-muted">
                  No verified launches captured yet. Run{' '}
                  <code className="font-mono text-ink-secondary">npm run capture</code>.
                </p>
              )
            ) : (
              <>
                <Segmented
                  label="Shape"
                  value={shape}
                  options={DEMAND_SHAPES}
                  onChange={setShape}
                />
                <Slider
                  label="Buy orders" value={buys} min={5} max={2000} log
                  onChange={(v) => setBuys(Math.round(v))} format={(v) => String(Math.round(v))}
                />
                <Slider
                  label="Total demand" value={totalQuote} min={1} max={10000} log
                  onChange={setTotalQuote} format={(v) => sol(v)}
                />
                <Slider
                  label="Token supply" value={supply} min={1e6} max={1e12} log
                  onChange={setSupply} format={(v) => sig(v)}
                />
              </>
            )}
          </Panel>

          {curves.map((c) => (
            <Panel
              key={c.id}
              title={c.label}
              action={
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: seriesColor(c.slot) }}
                  />
                  {curves.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeCurve(c.id)}
                      aria-label={`Remove ${c.label}`}
                      className="cursor-pointer rounded px-1 text-[11px] text-ink-muted transition-colors duration-150 hover:text-[var(--status-critical)]"
                    >
                      remove
                    </button>
                  )}
                </div>
              }
            >
              <Slider
                label="SOL to graduate"
                value={c.curve.migrationThresholdQuote}
                min={Math.min(0.5, c.curve.migrationThresholdQuote)} max={Math.max(5000, c.curve.migrationThresholdQuote)} log
                accent={seriesColor(c.slot)}
                onChange={(v) => update(c.id, { migrationThresholdQuote: v })}
                format={(v) => sol(v)}
                hint="Buy demand the curve must absorb before it migrates to DAMM v2."
              />
              <Slider
                label="Curve length"
                value={c.curve.curveLength}
                min={Math.min(1.05, c.curve.curveLength)} max={Math.max(1000, c.curve.curveLength)} log
                accent={seriesColor(c.slot)}
                onChange={(v) => update(c.id, { curveLength: v })}
                format={(v) => `${v < 10 ? v.toFixed(2) : Math.round(v)}x`}
                hint="How far the price runs from start to migration."
              />
              <Slider
                label="Base fee"
                value={c.curve.baseFeeBps}
                min={25} max={2000} step={5}
                accent={seriesColor(c.slot)}
                onChange={(v) => update(c.id, { baseFeeBps: Math.round(v) })}
                format={(v) => `${(v / 100).toFixed(2)}%`}
              />
              {(() => {
                const o = outcomes.find((x) => x.id === c.id)
                if (!o || o.error) return null
                return (
                  <p className="tnum mt-1 text-[10px] leading-tight text-ink-muted">
                    {sig(o.initialMarketCap)} → {sig(o.migrationMarketCap)} SOL market cap
                  </p>
                )
              })()}
            </Panel>
          ))}

          {curves.length < MAX_CURVES && (
            <button
              type="button"
              onClick={addCurve}
              className="cursor-pointer rounded-md border border-dashed border-[var(--axis)] py-2 text-[11px] text-ink-muted transition-colors duration-150 hover:border-[var(--ink-muted)] hover:text-ink-secondary"
            >
              Add a curve to compare
            </button>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {error && (
            <div
              role="alert"
              className="rounded-md border border-[var(--status-critical)] bg-surface px-3 py-2 text-[12px] text-ink"
            >
              {error}
            </div>
          )}

          {verdict && (
            <section className="rounded-md border border-[var(--hairline)] bg-surface p-4">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <p className="text-[11px] text-ink-muted">
                    Most DBC fee earned: {verdict.best.label}
                  </p>
                  <p className="mt-0.5 text-[48px] font-semibold leading-none tracking-tight text-ink">
                    {sol(verdict.best.tradingFee, 3)}
                  </p>
                </div>
                {verdict.delta !== null && (
                  <div>
                    <p className="text-[11px] text-ink-muted">vs the curve they actually used</p>
                    <p
                      className="mt-0.5 text-[20px] font-semibold leading-none"
                      style={{
                        color:
                          verdict.delta >= 0 ? 'var(--status-good)' : 'var(--status-critical)',
                      }}
                    >
                      {verdict.delta >= 0 ? '+' : ''}
                      {pct(verdict.delta, 1)}
                    </p>
                  </div>
                )}
              </div>
              {verdict.sentence && (
                <p className="mt-3 max-w-3xl text-[12px] leading-relaxed text-ink-secondary">
                  {verdict.sentence}
                </p>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
                Buys-only scenario. Partner + creator fees are valued in SOL at execution;
                actual proceeds may be base tokens. DAMM v2 fees after migration are not modeled.
              </p>
            </section>
          )}

          <div
            className={`flex flex-col gap-4 transition-opacity duration-150 ${
              pending && result ? 'opacity-60' : 'opacity-100'
            }`}
          >
            <div className="rounded-md border border-[var(--hairline)] bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div
                  role="radiogroup"
                  aria-label="Chart view"
                  className="flex gap-1"
                >
                  {CHART_VIEWS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={chartView === v.id}
                      onClick={() => setChartView(v.id)}
                      className={`cursor-pointer rounded border px-2.5 py-1 text-[11px] transition-colors duration-150 ${
                        chartView === v.id
                          ? 'border-[var(--ink-secondary)] bg-[var(--surface-raised)] text-ink'
                          : 'border-[var(--hairline)] text-ink-muted hover:border-[var(--axis)] hover:text-ink-secondary'
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-ink-muted">
                  {CHART_VIEWS.find((v) => v.id === chartView)?.detail}
                </p>
              </div>
              <LineChart
                title={
                  chartView === 'progress' ? 'Fill to graduation' : 'Price multiple from start'
                }
                // The toggle above is the visible heading for this chart;
                // repeating it here would print the same words twice.
                titleVisuallyHidden
                subtitle="each line ends where its curve stopped pricing trades"
                series={chartSeries(chartView)}
                formatY={(v) => (chartView === 'progress' ? `${Math.round(v)}%` : `${sig(v, 3)}x`)}
                xLabel="trade"
                height={280}
                // Pinned on the progress view so a curve that never filled is
                // drawn short of the top, which is the whole point of it.
                yDomainMax={chartView === 'progress' ? 100 : undefined}
                endNote={(s) => {
                  const c = [...outcomes, ...(baseline ? [baseline] : [])].find(
                    (o) => o.id === s.id,
                  )
                  if (!c) return null
                  return c.graduatedAtTrade ? `graduated #${c.graduatedAtTrade}` : 'no graduation'
                }}
              />
            </div>

            <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
              <div className="min-w-0 rounded-md border border-[var(--hairline)] bg-surface p-4">
                <LineChart
                  title="Fee earned"
                  subtitle="cumulative partner + creator share"
                  series={chartSeries('fee')}
                  formatY={(v) => sig(v, 2)}
                  xLabel="trade"
                  height={230}
                />
              </div>
              <div className="min-w-0 rounded-md border border-[var(--hairline)] bg-surface p-4">
                {outcomes.length > 0 && (
                  <CaptureBar
                    total={demandTotal}
                    rows={[
                      ...outcomes
                        .filter((c) => !c.error)
                        .map((c) => ({
                          id: c.id,
                          label: c.label,
                          color: seriesColor(c.slot),
                          captured: c.quoteThroughCurve,
                          stranded: c.quoteStranded,
                          unfilled: c.quoteUnfilled,
                        })),
                      ...(baseline
                        ? [
                            {
                              id: 'baseline',
                              label: baseline.label,
                              color: 'var(--ink-muted)',
                              captured: baseline.quoteThroughCurve,
                              stranded: baseline.quoteStranded,
                              unfilled: baseline.quoteUnfilled,
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              </div>
            </div>

            <div className="rounded-md border border-[var(--hairline)] bg-surface p-4">
              <h3 className="mb-2.5 text-[13px] font-semibold tracking-wide text-ink">
                Every curve, same demand
              </h3>
              <ComparisonTable curves={outcomes} baseline={baseline} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tnum text-ink">{value}</dd>
    </div>
  )
}
