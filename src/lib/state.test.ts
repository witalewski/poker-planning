import { describe, expect, it } from 'vitest'
import {
  createRound,
  initialState,
  reducer,
  shouldAutoReveal,
  summarize,
} from './state'
import type { Action, Participant, Round } from './types'

const participant = (id: string, name = id, joinedAt = id.charCodeAt(0)): Participant => ({
  id,
  name,
  joinedAt,
})

const startState = () => {
  let state = initialState('ABC123')
  state = reducer(state, { type: 'PARTICIPANT_JOIN', participant: participant('alice') })
  state = reducer(state, { type: 'PARTICIPANT_JOIN', participant: participant('bob') })
  return state
}

describe('reducer', () => {
  it('adds participants and ignores duplicate joins', () => {
    let state = initialState('S')
    state = reducer(state, { type: 'PARTICIPANT_JOIN', participant: participant('alice') })
    state = reducer(state, { type: 'PARTICIPANT_JOIN', participant: participant('alice', 'Alice2') })
    expect(Object.keys(state.participants)).toEqual(['alice'])
    expect(state.participants.alice.name).toBe('alice')
  })

  it('removes participants on leave and strips their vote from the active round', () => {
    let state = startState()
    const round = createRound({ id: 'r1', title: 't', startedBy: 'alice' })
    state = reducer(state, { type: 'ROUND_START', round })
    state = reducer(state, { type: 'VOTE', participantId: 'bob', value: '5' })
    state = reducer(state, { type: 'PARTICIPANT_LEAVE', participantId: 'bob' })
    expect(state.participants.bob).toBeUndefined()
    expect(state.currentRound?.votes.bob).toBeUndefined()
  })

  it('records votes but not while round is revealed', () => {
    let state = startState()
    const round = createRound({ id: 'r1', title: 't', startedBy: 'alice' })
    state = reducer(state, { type: 'ROUND_START', round })
    state = reducer(state, { type: 'VOTE', participantId: 'alice', value: '3' })
    expect(state.currentRound?.votes.alice).toBe('3')
    state = reducer(state, { type: 'REVEAL', by: 'alice', at: 100 })
    state = reducer(state, { type: 'VOTE', participantId: 'alice', value: '5' })
    expect(state.currentRound?.votes.alice).toBe('3')
  })

  it('clears a vote via UNVOTE', () => {
    let state = startState()
    const round = createRound({ id: 'r1', title: 't', startedBy: 'alice' })
    state = reducer(state, { type: 'ROUND_START', round })
    state = reducer(state, { type: 'VOTE', participantId: 'alice', value: '8' })
    state = reducer(state, { type: 'UNVOTE', participantId: 'alice' })
    expect(state.currentRound?.votes.alice).toBeUndefined()
  })

  it('pushes revealed rounds onto history when a new round starts', () => {
    let state = startState()
    const r1 = createRound({ id: 'r1', title: 'Story A', startedBy: 'alice' })
    state = reducer(state, { type: 'ROUND_START', round: r1 })
    state = reducer(state, { type: 'VOTE', participantId: 'alice', value: '5' })
    state = reducer(state, { type: 'REVEAL', by: 'alice', at: 10 })
    const r2 = createRound({ id: 'r2', title: 'Story B', startedBy: 'bob' })
    state = reducer(state, { type: 'ROUND_START', round: r2 })
    expect(state.history.map((r) => r.id)).toEqual(['r1'])
    expect(state.currentRound?.id).toBe('r2')
  })

  it('does not push an unrevealed round onto history (it gets replaced)', () => {
    let state = startState()
    const r1 = createRound({ id: 'r1', title: 'Story A', startedBy: 'alice' })
    state = reducer(state, { type: 'ROUND_START', round: r1 })
    const r2 = createRound({ id: 'r2', title: 'Story B', startedBy: 'bob' })
    state = reducer(state, { type: 'ROUND_START', round: r2 })
    expect(state.history).toHaveLength(0)
    expect(state.currentRound?.id).toBe('r2')
  })

  it('REVEAL is idempotent and preserves original reveal time', () => {
    let state = startState()
    const round = createRound({ id: 'r1', title: 't', startedBy: 'alice' })
    state = reducer(state, { type: 'ROUND_START', round })
    state = reducer(state, { type: 'REVEAL', by: 'alice', at: 10 })
    state = reducer(state, { type: 'REVEAL', by: 'bob', at: 99 })
    expect(state.currentRound?.revealedAt).toBe(10)
  })

  it('HELLO_SYNC merges participants and keeps the reveal sticky', () => {
    let local = startState()
    const round = createRound({ id: 'r1', title: 't', startedBy: 'alice' })
    local = reducer(local, { type: 'ROUND_START', round })
    local = reducer(local, { type: 'VOTE', participantId: 'alice', value: '5' })
    local = reducer(local, { type: 'REVEAL', by: 'alice', at: 50 })

    const remote = {
      ...local,
      participants: { ...local.participants, carol: participant('carol') },
      currentRound: { ...round, votes: { ...round.votes, bob: '8' as const }, revealed: false, revealedAt: null },
      history: [],
    }

    const synced = reducer(local, { type: 'HELLO_SYNC', state: remote })
    expect(synced.participants.carol).toBeTruthy()
    expect(synced.currentRound?.revealed).toBe(true)
    expect(synced.currentRound?.votes.alice).toBe('5')
    expect(synced.currentRound?.votes.bob).toBe('8')
  })

  it('HELLO_SYNC ignores state from a different session', () => {
    const local = startState()
    const wrong: typeof local = { ...local, sessionId: 'OTHER' }
    const synced = reducer(local, { type: 'HELLO_SYNC', state: wrong })
    expect(synced).toBe(local)
  })
})

describe('shouldAutoReveal', () => {
  it('is false with no round', () => {
    expect(shouldAutoReveal(initialState('S'))).toBe(false)
  })

  it('is false until every participant has voted', () => {
    let state = startState()
    const round = createRound({ id: 'r1', title: 't', startedBy: 'alice' })
    state = reducer(state, { type: 'ROUND_START', round })
    state = reducer(state, { type: 'VOTE', participantId: 'alice', value: '3' })
    expect(shouldAutoReveal(state)).toBe(false)
    state = reducer(state, { type: 'VOTE', participantId: 'bob', value: '5' })
    expect(shouldAutoReveal(state)).toBe(true)
  })

  it('returns false once the round is already revealed', () => {
    let state = startState()
    const round = createRound({ id: 'r1', title: 't', startedBy: 'alice' })
    state = reducer(state, { type: 'ROUND_START', round })
    state = reducer(state, { type: 'VOTE', participantId: 'alice', value: '3' })
    state = reducer(state, { type: 'VOTE', participantId: 'bob', value: '5' })
    state = reducer(state, { type: 'REVEAL', by: 'alice', at: 10 })
    expect(shouldAutoReveal(state)).toBe(false)
  })
})

describe('summarize', () => {
  const r = (votes: Record<string, string>): Round => ({
    id: 'x',
    title: '',
    startedBy: 'a',
    startedAt: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    votes: votes as any,
    revealed: true,
    revealedAt: 1,
  })

  it('handles unanimous numeric votes', () => {
    const s = summarize(r({ a: '5', b: '5', c: '5' }))
    expect(s.consensus).toBe(true)
    expect(s.average).toBe(5)
    expect(s.median).toBe(5)
    expect(s.mode).toBe('5')
    expect(s.count).toBe(3)
    expect(s.questionCount).toBe(0)
  })

  it('computes average, median, mode with mixed votes', () => {
    const s = summarize(r({ a: '1', b: '3', c: '3', d: '13' }))
    expect(s.average).toBe(5)
    expect(s.median).toBe(3)
    expect(s.mode).toBe('3')
    expect(s.consensus).toBe(false)
  })

  it('counts question marks but excludes them from averages', () => {
    const s = summarize(r({ a: '5', b: '?', c: '?' }))
    expect(s.questionCount).toBe(2)
    expect(s.average).toBe(5)
    expect(s.consensus).toBe(false)
  })

  it('returns null numerics when only question marks were cast', () => {
    const s = summarize(r({ a: '?', b: '?' }))
    expect(s.average).toBeNull()
    expect(s.median).toBeNull()
    expect(s.mode).toBe('?')
  })

  it('median with even count averages the middle two', () => {
    const s = summarize(r({ a: '2', b: '8' }))
    expect(s.median).toBe(5)
  })
})

describe('actions type exhaustiveness smoke', () => {
  it('unknown action types do not crash', () => {
    const state = initialState('S')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const next = reducer(state, { type: 'NOT_A_REAL_ACTION' } as any as Action)
    expect(next).toBe(state)
  })
})
