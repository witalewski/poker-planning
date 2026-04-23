import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSnapshot, readSnapshot, writeSnapshot } from './persist'
import { initialState, reducer, createRound } from './state'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('persist', () => {
  it('round-trips state via writeSnapshot / readSnapshot', () => {
    let state = initialState('S1')
    state = reducer(state, {
      type: 'PARTICIPANT_JOIN',
      participant: { id: 'alice', name: 'Alice', joinedAt: 1 },
    })
    state = reducer(state, {
      type: 'ROUND_START',
      round: createRound({ id: 'r1', title: 'Story' }),
    })
    writeSnapshot('S1', state)

    const restored = readSnapshot('S1')
    expect(restored?.currentRound?.id).toBe('r1')
    expect(restored?.participants.alice.name).toBe('Alice')
  })

  it('returns null for a missing snapshot', () => {
    expect(readSnapshot('missing')).toBeNull()
  })

  it('rejects snapshots from a different sessionId', () => {
    const state = initialState('S1')
    writeSnapshot('S1', state)
    expect(readSnapshot('S2')).toBeNull()
  })

  it('rejects stale snapshots older than 2h', () => {
    const state = initialState('S1')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
    writeSnapshot('S1', state)
    vi.setSystemTime(new Date('2025-01-01T03:00:00Z')) // 3 hours later
    expect(readSnapshot('S1')).toBeNull()
  })

  it('clearSnapshot removes the entry', () => {
    const state = initialState('S1')
    writeSnapshot('S1', state)
    clearSnapshot('S1')
    expect(readSnapshot('S1')).toBeNull()
  })

  it('survives malformed JSON without throwing', () => {
    localStorage.setItem('poker-snap-S1', '{not-json')
    expect(readSnapshot('S1')).toBeNull()
  })
})
