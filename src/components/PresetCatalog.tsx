'use client'

import { useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { SimulateRequest } from '@/lib/api/types'
import {
  availabilityIssue, createPreset, exportPreset, importPreset, MAX_PRESET_BYTES,
  STARTER_PRESETS, type Preset,
} from '@/lib/presets/catalog'
import { getLibrarySnapshot, readLibrary, saveToBrowser, subscribeLibrary } from '@/lib/presets/storage'
import { sig } from '@/lib/ui/format'

const button = 'min-h-9 cursor-pointer rounded border border-hairline px-3 py-1.5 text-[12px] text-ink-secondary transition-colors hover:border-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'
const input = 'mt-1 w-full rounded border border-hairline bg-plane px-3 py-2 text-[13px] text-ink'
const serverSnapshot = () => ''

function download(preset: Preset) {
  const url = URL.createObjectURL(new Blob([exportPreset(preset)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'curve-lab'}.curvelab.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function PresetCatalog({ request, poolAddresses, canSave, onLoad }: {
  request: SimulateRequest
  poolAddresses: string[]
  canSave: boolean
  onLoad: (preset: Preset) => void
}) {
  const snapshot = useSyncExternalStore(subscribeLibrary, getLibrarySnapshot, serverSnapshot)
  const library = useMemo(() => {
    try { return { presets: readLibrary(snapshot), error: null } }
    catch (e) { return { presets: [] as Preset[], error: (e as Error).message } }
  }, [snapshot])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'mine' | 'starters'>('all')
  const [active, setActive] = useState<Preset | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [useCase, setUseCase] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const fieldID = useId()
  const modified = active && JSON.stringify(active.simulation) !== JSON.stringify(request)

  function edit(preset: Preset | null = active) {
    setName(preset ? `${preset.name.slice(0, 57)} (copy)` : 'Untitled experiment')
    setDescription(preset?.description ?? '')
    setUseCase(preset?.useCase ?? '')
    setEditing(true)
    setOpen(true)
    setError('')
    setNotice('')
    requestAnimationFrame(() => nameInput.current?.focus())
  }

  function load(preset: Preset, fork = false) {
    const issue = availabilityIssue(preset, poolAddresses)
    if (issue) { setError(issue); return }
    onLoad(preset)
    setActive(preset)
    setEditing(false)
    setError('')
    setNotice(`Loaded ${preset.name}. Demand and all curve settings have been restored.`)
    if (fork) edit(preset)
  }

  function save(asFile: boolean) {
    setError('')
    if (!canSave) { setError('Wait for a successful simulation before saving these settings.'); return }
    try {
      const preset = createPreset({ name, description, useCase }, request, active ?? undefined)
      if (asFile) {
        download(preset)
        setNotice(`Exported ${preset.name} as a portable simulation preset.`)
      } else {
        saveToBrowser(preset)
        setActive(preset)
        setEditing(false)
        setFilter('mine')
        setQuery('')
        setNotice(`Saved ${preset.name} in this browser. Export a file to keep a portable backup.`)
      }
    } catch (e) { setError((e as Error).message) }
  }

  async function readFile(file: File) {
    setError('')
    setNotice('')
    try {
      if (file.size > MAX_PRESET_BYTES) throw new Error('Preset files must be smaller than 64 KB.')
      const preset = importPreset(await file.text())
      saveToBrowser(preset)
      setOpen(true)
      setFilter('mine')
      setQuery('')
      setNotice(`Imported ${preset.name}. ${availabilityIssue(preset, poolAddresses) ?? 'Select Load to restore its comparison.'}`)
    } catch (e) { setError((e as Error).message) }
  }

  const catalog = [
    ...(filter === 'mine' ? [] : STARTER_PRESETS.map((preset) => ({ preset, starter: true }))),
    ...(filter === 'starters' ? [] : library.presets.map((preset) => ({ preset, starter: false }))),
  ].filter(({ preset }) => `${preset.name} ${preset.description} ${preset.useCase}`.toLowerCase().includes(query.toLowerCase().trim()))

  return (
    <section aria-label="Preset catalog" className="mt-5 rounded-md border border-hairline bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 max-w-full">
          <h2 className="text-[13px] font-semibold">Preset library</h2>
          <p className="mt-0.5 break-words text-[11px] text-ink-muted">
            {active ? `${active.name}${modified ? ' / unsaved changes' : ' / loaded'}` : 'Start with a question. Keep the experiment that answers it.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} aria-expanded={open} aria-controls="preset-library" onClick={() => setOpen(!open)}>
            {open ? 'Close library' : `Browse presets (${STARTER_PRESETS.length + library.presets.length})`}
          </button>
          <button type="button" className={button} disabled={!canSave} onClick={() => edit()} title={canSave ? 'Save the current demand and curves together' : 'Waiting for a successful simulation of the current settings'}>
            Save current
          </button>
          <button type="button" className={button} onClick={() => fileInput.current?.click()}>Import JSON</button>
          <input ref={fileInput} type="file" className="hidden" accept=".json,application/json" aria-label="Import preset file" onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            e.currentTarget.value = ''
            if (file) void readFile(file)
          }} />
        </div>
      </div>
      {(error || library.error) && <p role="alert" className="break-words border-t border-hairline px-4 py-3 text-[12px] text-status-warning">{error || library.error}</p>}
      <p role="status" className={notice ? 'break-words border-t border-hairline px-4 py-3 text-[12px] text-ink-secondary' : 'sr-only'}>{notice}</p>
      {open && (
        <div id="preset-library" className="border-t border-hairline px-4 pb-4">
          {editing && (
            <form aria-label="Save preset" className="my-4 border-b border-hairline pb-4" onSubmit={(e) => { e.preventDefault(); save(false) }}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[13px] font-semibold">{active ? 'Fork this experiment' : 'Save this experiment'}</h3>
                <button type="button" className={button} onClick={() => setEditing(false)}>Cancel</button>
              </div>
              <p className="mt-1 text-[11px] text-ink-muted">Includes the current demand and all {request.curves.length} curves. Each save creates a separate preset.</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="text-[12px] text-ink-secondary">
                  <label htmlFor={`${fieldID}-name`}>Preset name</label>
                  <input id={`${fieldID}-name`} ref={nameInput} className={input} value={name} maxLength={64} required onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="text-[12px] text-ink-secondary">
                  <label htmlFor={`${fieldID}-use`}>Intended use</label>
                  <input id={`${fieldID}-use`} className={input} value={useCase} maxLength={160} placeholder="What question does this comparison explore?" onChange={(e) => setUseCase(e.target.value)} />
                </div>
                <div className="text-[12px] text-ink-secondary md:col-span-2">
                  <label htmlFor={`${fieldID}-description`}>Description</label>
                  <textarea id={`${fieldID}-description`} className={`${input} min-h-20 resize-y`} value={description} maxLength={500} rows={2} onChange={(e) => setDescription(e.target.value)} />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="submit" className={button} disabled={!canSave || !name.trim() || !!library.error}>Save to my library</button>
                <button type="button" className={button} disabled={!canSave || !name.trim()} onClick={() => save(true)}>Export current JSON</button>
                <span className="text-[11px] text-ink-muted">{canSave ? 'Browser storage is local. Export for sharing or backup.' : 'Waiting for a successful simulation of these settings.'}</span>
              </div>
            </form>
          )}
          <div className="my-4 flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label="Filter presets" className="flex flex-wrap gap-2">
              {(['all', 'starters', 'mine'] as const).map((value) => (
                <button key={value} type="button" className={`${button} ${filter === value ? 'border-ink-muted bg-surface-raised text-ink' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  {value === 'all' ? 'All presets' : value === 'mine' ? 'My presets' : 'Free starters'}
                </button>
              ))}
            </div>
            <label className="w-full sm:w-64">
              <span className="sr-only">Search presets</span>
              <input type="search" className={input} value={query} placeholder="Search presets" onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {catalog.map(({ preset, starter }) => {
              const issue = availabilityIssue(preset, poolAddresses)
              const demand = preset.simulation.demand
              return (
                <article key={`${starter ? 'starter' : 'saved'}-${preset.id}`} aria-label={preset.name} className="flex min-w-0 flex-col rounded border border-hairline bg-plane p-4">
                  <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.08em] text-ink-muted">
                    <span>{starter ? 'Free starter' : 'Saved locally'}</span>
                    <span>{preset.simulation.curves.length} curves</span>
                  </div>
                  <h3 className="mt-2 break-words text-[15px] font-semibold">{preset.name}</h3>
                  <p className="mt-2 break-words text-[12px] leading-relaxed text-ink-secondary">{preset.description || 'A saved Curve Lab comparison.'}</p>
                  {preset.useCase && <p className="mt-2 break-words text-[11px] leading-relaxed text-ink-muted">{preset.useCase}</p>}
                  <p className="mt-3 text-[11px] text-ink-secondary">{demand.kind === 'pool' ? 'Verified launch demand' : `${sig(demand.totalQuote)} SOL / ${demand.buys} buys / ${demand.shape === 'frontloaded' ? 'front-loaded' : demand.shape}`}</p>
                  <ul className="mt-2 space-y-1 text-[11px] text-ink-muted">
                    {preset.simulation.curves.map((c) => <li key={c.id} className="break-words">{c.label}: {sig(c.curve.migrationThresholdQuote)} SOL / {sig(c.curve.curveLength)}x / {(c.curve.baseFeeBps / 100).toFixed(2)}%</li>)}
                  </ul>
                  {preset.forkedFrom && <p className="mt-2 break-words text-[10px] text-ink-muted">Forked from {preset.forkedFrom.name}</p>}
                  {issue && <p className="mt-2 text-[11px] text-status-warning">Launch unavailable here. Export remains available.</p>}
                  <div className="mt-auto flex flex-wrap gap-2 pt-4">
                    <button type="button" className={button} disabled={!!issue} onClick={() => load(preset)}>Load</button>
                    <button type="button" className={button} disabled={!!issue} onClick={() => load(preset, true)}>Fork</button>
                    <button type="button" className={button} onClick={() => download(preset)}>Export JSON</button>
                  </div>
                </article>
              )
            })}
          </div>
          {!catalog.length && <p className="py-8 text-center text-[13px] text-ink-muted">{query.trim() ? 'No presets match this search.' : 'No saved presets yet. Save a comparison or fork a free starter.'}</p>}
          <p className="mt-4 text-[11px] leading-relaxed text-ink-muted">Presets contain simulation inputs. They do not deploy tokens. Mainnet presets reference a launch in this installation; synthetic presets work without a launch history.</p>
        </div>
      )}
    </section>
  )
}
