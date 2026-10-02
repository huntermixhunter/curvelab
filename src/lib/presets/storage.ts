import { MAX_SAVED_PRESETS, parsePreset, type Preset } from './catalog'

export const STORAGE_KEY = 'curvelab.presets.v1'
const CHANGED = 'curvelab-presets-changed'
const UNAVAILABLE = '!storage-unavailable'

export function getLibrarySnapshot(): string {
  try { return window.localStorage.getItem(STORAGE_KEY) ?? '' } catch { return UNAVAILABLE }
}

export function subscribeLibrary(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) callback()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGED, callback)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGED, callback)
  }
}

export function readLibrary(snapshot: string): Preset[] {
  if (!snapshot) return []
  if (snapshot === UNAVAILABLE) throw new Error('Browser storage is unavailable. You can still load starters and export files.')
  try {
    const data = JSON.parse(snapshot)
    if (data.version !== 1 || !Array.isArray(data.presets) || data.presets.length > MAX_SAVED_PRESETS) throw new Error()
    const presets: Preset[] = data.presets.map(parsePreset)
    if (new Set(presets.map((p) => p.id)).size !== presets.length) throw new Error()
    return presets
  } catch {
    throw new Error('The saved library could not be read. It has been left untouched. Export new work to a file until browser storage is repaired.')
  }
}

/** Read immediately before writes so another tab's additions are retained. */
export function savePreset(preset: Preset, storage: Pick<Storage, 'getItem' | 'setItem'>): Preset[] {
  const parsed = parsePreset(preset)
  const existing = readLibrary(storage.getItem(STORAGE_KEY) ?? '')
  if (existing.some((p) => p.id === parsed.id)) throw new Error('That preset is already in your library. Fork it to make a separate copy.')
  if (existing.length >= MAX_SAVED_PRESETS) throw new Error('The library is full (100 presets). Export this experiment to a file.')
  const next = [parsed, ...existing]
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, presets: next })) }
  catch { throw new Error('The browser could not save this preset. Your existing library is unchanged. Export a file to keep this work.') }
  return next
}

export function saveToBrowser(preset: Preset): void {
  savePreset(preset, window.localStorage)
  window.dispatchEvent(new Event(CHANGED))
}
