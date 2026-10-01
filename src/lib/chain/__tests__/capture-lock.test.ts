import { expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireCaptureLock } from '../../../../scripts/capture-lock'

it('prevents duplicate collectors and releases the lock on exit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'curvelab-capture-'))
  const path = join(directory, 'capture.lock')
  try {
    const release = acquireCaptureLock(path)
    expect(() => acquireCaptureLock(path)).toThrow('Capture already running')
    release()
    expect(existsSync(path)).toBe(false)
    acquireCaptureLock(path)()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
