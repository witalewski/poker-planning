import type { SessionState } from './types'

const SCHEMA_VERSION = 1
const TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

interface Snapshot {
  schemaVersion: number
  updatedAt: number
  state: SessionState
}

const storageKey = (sessionId: string) => `poker-snap-${sessionId}`

/**
 * Read a recent local snapshot for this session, used to seed state when the
 * mesh is briefly empty (e.g., last peer closed and someone rejoins soon after).
 * Returns null if no snapshot exists, it's stale, malformed, or on a different schema.
 */
export function readSnapshot(sessionId: string): SessionState | null {
  try {
    const raw = localStorage.getItem(storageKey(sessionId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Snapshot
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null
    if (Date.now() - parsed.updatedAt > TTL_MS) return null
    if (!parsed.state || parsed.state.sessionId !== sessionId) return null
    return parsed.state
  } catch {
    return null
  }
}

export function writeSnapshot(sessionId: string, state: SessionState): void {
  try {
    const snap: Snapshot = { schemaVersion: SCHEMA_VERSION, updatedAt: Date.now(), state }
    localStorage.setItem(storageKey(sessionId), JSON.stringify(snap))
  } catch {
    // localStorage may be full or disabled; ignore.
  }
}

export function clearSnapshot(sessionId: string): void {
  try {
    localStorage.removeItem(storageKey(sessionId))
  } catch {
    // ignore
  }
}
