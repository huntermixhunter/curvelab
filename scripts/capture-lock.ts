import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

/** Refuse overlapping collectors, which share one public RPC rate limit. */
export function acquireCaptureLock(path: string): () => void {
  try {
    writeFileSync(path, String(process.pid), { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const owner = Number(readFileSync(path, 'utf8'))
    if (!Number.isInteger(owner) || owner <= 0) throw new Error(`Invalid capture lock: ${path}`)
    try {
      process.kill(owner, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      unlinkSync(path)
      return acquireCaptureLock(path)
    }
    throw new Error(`Capture already running (PID ${owner}). See data/capture.log.`)
  }
  return () => {
    try {
      if (readFileSync(path, 'utf8') === String(process.pid)) unlinkSync(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
