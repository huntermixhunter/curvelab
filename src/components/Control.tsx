'use client'

import { useId } from 'react'
import { rangeValue } from '@/lib/ui/range'

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  /** Map the track logarithmically. Required when a range spans decades. */
  log?: boolean
  step?: number
  format: (value: number) => string
  /** Thumb colour, so a control reads as belonging to its curve. */
  accent?: string
  hint?: string
}

const STEPS = 1000

/**
 * A labelled slider.
 *
 * Log mapping is not a nicety here. Initial market cap spans roughly 1 to
 * 100,000 SOL and a linear track puts every value a launch would plausibly use
 * inside the first pixel, so the control is unusable at exactly the settings
 * people need.
 */
export function Slider({
  label, value, min, max, onChange, log = false, step, format, accent, hint,
}: SliderProps) {
  const id = useId()

  const toPosition = (v: number) =>
    log
      ? (Math.log(Math.max(v, min) / min) / Math.log(max / min)) * STEPS
      : ((v - min) / (max - min)) * STEPS

  const fromPosition = (p: number) => rangeValue(p, min, max, log, step)

  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[11px] text-ink-secondary">
          {label}
        </label>
        <span className="tnum text-[11px] font-medium text-ink">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={STEPS}
        step={1}
        value={Math.round(toPosition(value))}
        onChange={(e) => onChange(fromPosition(Number(e.target.value)))}
        style={accent ? ({ ['--thumb' as string]: accent } as React.CSSProperties) : undefined}
        aria-valuetext={format(value)}
      />
      {hint && <p className="mt-0.5 text-[10px] leading-tight text-ink-muted">{hint}</p>}
    </div>
  )
}

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: { id: T; label: string; detail?: string }[]
  onChange: (value: T) => void
}

export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  const active = options.find((o) => o.id === value)
  return (
    <div className="py-1.5">
      <span className="mb-1 block text-[11px] text-ink-secondary">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={`flex-1 cursor-pointer rounded border px-2 py-1.5 text-[11px] transition-colors duration-150 ${
              value === o.id
                ? 'border-[var(--ink-secondary)] bg-[var(--surface-raised)] text-ink'
                : 'border-[var(--hairline)] text-ink-muted hover:border-[var(--axis)] hover:text-ink-secondary'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {active?.detail && (
        <p className="mt-1 text-[10px] leading-tight text-ink-muted">{active.detail}</p>
      )}
    </div>
  )
}

export function Panel({
  title, children, action,
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="rounded-md border border-[var(--hairline)] bg-surface p-3">
      <header className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  )
}
