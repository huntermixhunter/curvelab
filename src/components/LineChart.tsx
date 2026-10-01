'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { niceTicks, sig } from '@/lib/ui/format'

export interface ChartSeries {
  id: string
  label: string
  color: string
  points: { x: number; y: number }[]
  /** Drawn as a dashed hairline. Reserved for the reference baseline. */
  reference?: boolean
}

interface Props {
  series: ChartSeries[]
  title: string
  subtitle?: string
  /** Formats a y value for ticks, labels, and the tooltip. */
  formatY: (value: number) => string
  xLabel: string
  height?: number
  /** Keep the title for screen readers but let a visible control name the view. */
  titleVisuallyHidden?: boolean
  /** Appended to each end label, e.g. a graduation marker. */
  endNote?: (s: ChartSeries) => string | null
  /**
   * Pin the top of the y axis.
   *
   * Needed whenever "did not reach the top" is itself the finding. On a
   * progress scale an auto-fitted axis would stretch a curve that only ever
   * filled 60% to touch the top of the plot, drawing the exact opposite of
   * what happened.
   */
  yDomainMax?: number
}

const M = { top: 14, right: 74, bottom: 28, left: 58 }

/**
 * A line chart over a shared x domain.
 *
 * Series are allowed to end at different x values, and that is load-bearing
 * rather than incidental: a curve stops pricing trades the moment it
 * graduates, so a short line is the chart saying "this curve was finished
 * here". Padding every series to a common length would erase the single most
 * important thing on the plot.
 */
export default function LineChart({
  series, title, subtitle, formatY, xLabel, height = 260, endNote, yDomainMax,
  titleVisuallyHidden = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(760)
  const [hoverX, setHoverX] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  const drawn = series.filter((s) => s.points.length > 0)

  // The x domain is read from the data rather than assumed to start at the
  // first trade, because a series may carry a pre-trade origin point at zero.
  const { xMin, xMax, yMax } = useMemo(() => {
    let lo = Number.POSITIVE_INFINITY
    let hi = 1
    let y = 0
    for (const s of drawn) {
      for (const p of s.points) {
        if (p.x < lo) lo = p.x
        if (p.x > hi) hi = p.x
        if (p.y > y) y = p.y
      }
    }
    return { xMin: Number.isFinite(lo) ? lo : 0, xMax: hi, yMax: y }
  }, [drawn])

  const plotW = Math.max(10, width - M.left - M.right)
  const plotH = height - M.top - M.bottom

  const ticks = niceTicks(yDomainMax ?? yMax)
  const yTop = yDomainMax ?? Math.max(ticks[ticks.length - 1] ?? 1, yMax, 1e-12)

  const span = xMax - xMin
  const sx = useCallback(
    (x: number) => M.left + (span <= 0 ? plotW : ((x - xMin) / span) * plotW),
    [xMin, span, plotW],
  )
  const sy = useCallback((y: number) => M.top + plotH - (y / yTop) * plotH, [plotH, yTop])

  const path = (s: ChartSeries) =>
    s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join('')

  /** Value of a series at the hovered trade index, or null if it had ended. */
  const valueAt = (s: ChartSeries, x: number): { x: number; y: number } | null => {
    if (!s.points.length) return null
    if (x > s.points[s.points.length - 1].x) return null
    let best = s.points[0]
    for (const p of s.points) {
      if (Math.abs(p.x - x) <= Math.abs(best.x - x)) best = p
      else break
    }
    return best
  }

  const fromPointer = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const ratio = (clientX - rect.left - M.left) / plotW
    const x = Math.round(xMin + ratio * span)
    setHoverX(Math.min(xMax, Math.max(xMin, x)))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Escape') return
    e.preventDefault()
    if (e.key === 'Escape') return setHoverX(null)
    const step = Math.max(1, Math.round(xMax / 60))
    const current = hoverX ?? Math.round((xMin + xMax) / 2)
    const next = e.key === 'ArrowLeft' ? current - step : current + step
    setHoverX(Math.min(xMax, Math.max(xMin, next)))
  }

  const hovered = hoverX === null ? [] : drawn.map((s) => ({ s, p: valueAt(s, hoverX) }))
  const tooltipLeft = hoverX === null ? 0 : sx(hoverX)
  const flip = tooltipLeft > M.left + plotW * 0.6

  // Nearby graduations share a y value. Stagger their labels on narrow charts
  // while keeping every endpoint marker at the actual data coordinate.
  const labelBoxes: { x: number; y: number; width: number }[] = []
  const endLabels = new Map<string, { y: number; note: string | null | undefined }>()
  for (const s of drawn) {
    const last = s.points[s.points.length - 1]
    const note = endNote?.(s)
    const x = sx(last.x) + 9
    const labelWidth = Math.max(formatY(last.y).length * 6, (note?.length ?? 0) * 5)
    let y = sy(last.y)
    for (let attempt = 0; attempt <= drawn.length; attempt++) {
      const overlaps = labelBoxes.some((b) =>
        x < b.x + b.width + 4 && x + labelWidth + 4 > b.x && Math.abs(y - b.y) < 26,
      )
      if (!overlaps) break
      const below = sy(last.y) + (attempt + 1) * 26
      y = below < height - M.bottom - 12 ? below : sy(last.y) - (attempt + 1) * 26
    }
    labelBoxes.push({ x, y, width: labelWidth })
    endLabels.set(s.id, { y, note })
  }

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className={titleVisuallyHidden ? "sr-only" : "text-[13px] font-semibold tracking-wide text-ink"}>{title}</h3>
        {subtitle && <span className="text-[11px] text-ink-muted">{subtitle}</span>}
      </figcaption>

      <div ref={wrapRef} className="relative w-full">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}. ${drawn.length} series over ${xMax} trades. Values in the comparison table below.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseMove={(e) => fromPointer(e.clientX)}
          onMouseLeave={() => setHoverX(null)}
          onTouchStart={(e) => fromPointer(e.touches[0].clientX)}
          onTouchMove={(e) => fromPointer(e.touches[0].clientX)}
          className="touch-pan-y select-none"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={M.left} x2={M.left + plotW} y1={sy(t)} y2={sy(t)}
                stroke="var(--grid)" strokeWidth={1} shapeRendering="crispEdges"
              />
              <text
                x={M.left - 8} y={sy(t)} dy="0.32em" textAnchor="end"
                className="tnum fill-[var(--ink-muted)] text-[10px]"
              >
                {formatY(t)}
              </text>
            </g>
          ))}

          <line
            x1={M.left} x2={M.left + plotW} y1={M.top + plotH} y2={M.top + plotH}
            stroke="var(--axis)" strokeWidth={1} shapeRendering="crispEdges"
          />
          <text x={M.left} y={height - 6} className="fill-[var(--ink-muted)] text-[10px]">
            {xLabel}
          </text>
          <text
            x={M.left + plotW} y={height - 6} textAnchor="end"
            className="tnum fill-[var(--ink-muted)] text-[10px]"
          >
            {sig(xMax, 3)}
          </text>

          {hoverX !== null && (
            <line
              x1={sx(hoverX)} x2={sx(hoverX)} y1={M.top} y2={M.top + plotH}
              stroke="var(--ink-muted)" strokeWidth={1} shapeRendering="crispEdges"
            />
          )}

          {drawn.map((s) => (
            <path
              key={s.id}
              d={path(s)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={s.reference ? '4 4' : undefined}
              opacity={s.reference ? 0.85 : 1}
            />
          ))}

          {/* End marker and direct label. Ringed in the surface colour so it
              stays legible where two curves finish on top of each other. */}
          {drawn.map((s) => {
            const last = s.points[s.points.length - 1]
            const label = endLabels.get(s.id)!
            const note = label.note
            return (
              <g key={`end-${s.id}`}>
                <circle
                  cx={sx(last.x)} cy={sy(last.y)} r={4}
                  fill={s.color} stroke="var(--surface)" strokeWidth={2}
                />
                <text
                  x={sx(last.x) + 9} y={label.y} dy="0.32em"
                  className="tnum fill-[var(--ink-secondary)] text-[10px]"
                >
                  {formatY(last.y)}
                </text>
                {note && (
                  <text
                    x={sx(last.x) + 9} y={label.y + 11} dy="0.32em"
                    className="fill-[var(--ink-muted)] text-[9px]"
                  >
                    {note}
                  </text>
                )}
              </g>
            )
          })}

          {hovered.map(({ s, p }) =>
            p ? (
              <circle
                key={`h-${s.id}`} cx={sx(p.x)} cy={sy(p.y)} r={4}
                fill={s.color} stroke="var(--surface)" strokeWidth={2}
              />
            ) : null,
          )}
        </svg>

        {hoverX !== null && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute top-2 z-10 min-w-[150px] rounded border border-[var(--hairline)] bg-[var(--surface-raised)] px-2.5 py-2 text-[11px] shadow-lg"
            style={flip ? { right: width - tooltipLeft + 10 } : { left: tooltipLeft + 10 }}
          >
            <div className="mb-1 text-ink-muted">
              {xLabel} <span className="tnum text-ink">{hoverX}</span>
            </div>
            {hovered.map(({ s, p }) => (
              <div key={s.id} className="flex items-center justify-between gap-3 py-0.5">
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: s.color }}
                  />
                  <span className="text-ink-secondary">{s.label}</span>
                </span>
                <span className="tnum text-ink">{p ? formatY(p.y) : 'ended'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  )
}
