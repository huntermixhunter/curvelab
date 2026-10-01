'use client'

import { useEffect, useRef, useState } from 'react'
import { sol } from '@/lib/ui/format'

export interface CaptureRow {
  id: string
  label: string
  color: string
  /** Quote that reached the curve. */
  captured: number
  /** Quote that arrived after graduation and routed past the curve. */
  stranded: number
  /** Quote returned by a partially filled buy. */
  unfilled: number
}

const BAR = 18
const ROW = 48
const RIGHT_W = 94
/** Surface-coloured separation between touching segments. */
const GAP = 2

/**
 * Where each curve's demand went.
 *
 * Every bar is the same total length, because every curve is fed the identical
 * order flow. That is what makes the comparison legible: the bars do not differ
 * in size, only in where they split, so the eye reads the split point directly
 * instead of comparing two lengths.
 */
export default function CaptureBar({ rows, total }: { rows: CaptureRow[]; total: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  const trackW = Math.max(40, width - RIGHT_W)
  const height = rows.length * ROW
  const scale = (v: number) => (total > 0 ? (v / total) * trackW : 0)

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold tracking-wide text-ink">Where the demand went</h3>
        <span className="text-[11px] text-ink-muted">{sol(total)} submitted</span>
      </figcaption>

      <div ref={wrapRef} className="w-full">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Demand filled, returned unfilled, and arriving after graduation, out of ${sol(total)} total. Exact values in the comparison table.`}
        >
          {rows.map((r, i) => {
            const y = i * ROW + 18
            const capW = Math.max(0, scale(r.captured))
            const refundW = Math.max(0, scale(r.unfilled))
            const strW = Math.max(0, scale(r.stranded))
            const hasStranded = r.stranded > 0 && strW > 1

            return (
              <g key={r.id}>
                <text
                  x={0} y={y - 7}
                  className="fill-[var(--ink-secondary)] text-[11px]"
                >
                  {r.label}
                </text>

                {/* Captured: square at the baseline, rounded at the data end
                    only when nothing follows it. */}
                <rect
                  x={0} y={y} width={capW} height={BAR}
                  rx={hasStranded || refundW > 0 ? 0 : 3} fill={r.color}
                >
                  <title>{`${r.label}: ${sol(r.captured)} through the curve`}</title>
                </rect>

                {refundW > 0 && (
                  <rect x={capW} y={y} width={refundW} height={BAR} fill="var(--ink-muted)">
                    <title>{`${r.label}: ${sol(r.unfilled)} returned unfilled at graduation`}</title>
                  </rect>
                )}

                {hasStranded && (
                  <rect
                    x={capW + refundW + GAP}
                    y={y}
                    width={Math.max(0, strW - GAP)}
                    height={BAR}
                    rx={3}
                    fill="var(--axis)"
                  >
                    <title>{`${r.label}: ${sol(r.stranded)} arrived after graduation`}</title>
                  </rect>
                )}

                <text
                  x={trackW + 10} y={y + BAR / 2} dy="0.32em"
                  className="tnum fill-[var(--ink-secondary)] text-[11px]"
                >
                  {r.stranded + r.unfilled > 0 ? `${sol(r.stranded + r.unfilled)} left` : 'all captured'}
                </text>
              </g>
            )
          })}

        </svg>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-muted">
        <span>Coloured: through curve</span>
        <span><span className="mr-1 inline-block h-2 w-2 bg-[var(--ink-muted)]" />Unfilled at graduation</span>
        <span><span className="mr-1 inline-block h-2 w-2 bg-[var(--axis)]" />After graduation</span>
      </div>
    </figure>
  )
}
