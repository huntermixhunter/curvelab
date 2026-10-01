'use client'

import type { Baseline, CurveOutcome } from '@/lib/api/types'
import { seriesColor, sig, sol } from '@/lib/ui/format'

const COLUMNS = [
  'Curve',
  'Migration target',
  'Graduated',
  'Through curve',
  'Unfilled',
  'Stranded',
  'Fee earned',
  'Final mcap',
] as const

function Row({ c, isBaseline }: { c: CurveOutcome; isBaseline?: boolean }) {
  const color = isBaseline ? 'var(--ink-muted)' : seriesColor(c.slot)

  return (
    <tr className="border-t border-[var(--hairline)]">
      <th scope="row" className="py-2 pr-3 text-left font-normal">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={
              isBaseline
                ? { border: `2px solid ${color}` }
                : { background: color }
            }
          />
          <span className="text-ink">{c.label}</span>
        </span>
      </th>
      {c.error ? (
        <td colSpan={7} className="py-2 text-[11px] text-[var(--status-critical)]">
          {c.error}
        </td>
      ) : (
        <>
          <td className="tnum py-2 pr-3 text-right text-ink-secondary">
            {sol(c.migrationThresholdQuote)}
          </td>
          <td className="tnum py-2 pr-3 text-right">
            {c.graduatedAtTrade ? (
              <span className="text-ink">#{c.graduatedAtTrade}</span>
            ) : (
              <span className="text-ink-muted">never</span>
            )}
          </td>
          <td className="tnum py-2 pr-3 text-right text-ink-secondary">
            {sol(c.quoteThroughCurve)}
          </td>
          <td className="tnum py-2 pr-3 text-right text-ink-secondary">
            {c.quoteUnfilled > 0 ? sol(c.quoteUnfilled) : 'none'}
          </td>
          <td className="tnum py-2 pr-3 text-right">
            {c.quoteStranded > 0 ? (
              <span className="text-ink-secondary">{sol(c.quoteStranded)}</span>
            ) : (
              <span className="text-ink-muted">none</span>
            )}
          </td>
          <td className="tnum py-2 pr-3 text-right font-medium text-ink">{sol(c.tradingFee, 3)}</td>
          <td className="tnum py-2 text-right text-ink-secondary">{sig(c.finalMarketCap)}</td>
        </>
      )}
    </tr>
  )
}

export default function ComparisonTable({
  curves,
  baseline,
}: {
  curves: CurveOutcome[]
  baseline?: Baseline
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-[12px]">
        <caption className="sr-only">
          Outcome of each curve under the same demand flow, with the launch that actually happened
          as a reference.
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={`pb-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-ink-muted ${
                  i === 0 ? 'text-left' : 'text-right'
                } ${i < COLUMNS.length - 1 ? 'pr-3' : ''}`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {curves.map((c) => (
            <Row key={c.id} c={c} />
          ))}
          {baseline && <Row c={baseline} isBaseline />}
        </tbody>
      </table>
      {baseline && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
          The reference row is the curve this pool actually launched on, replayed against the same
          buy-only flow. Sells are removed from both sides: a sell is denominated in base tokens, so
          its size depends on the curve the seller bought on and cannot be held constant across a
          comparison.
        </p>
      )}
    </div>
  )
}
