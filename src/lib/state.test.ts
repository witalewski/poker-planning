import { describe, expect, it } from 'vitest'
import {
  computeDigest,
  createRound,
  initialState,
  mergeParticipants,
  pickNewerRound,
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
    const round = createRound({ id: 'r1', title: 't' })
    state = reducer(state, { type: 'ROUND_START', round })
    state = reducer(state, { type: 'VOTE', participantId: 'bob', value: '5' })
    state = reducer(state, { type: 'PARTICIPANT_LEAVE', participantId: 'bob' })
    expect(state.participants.bob).toBeUndefined()
    expect(state.currentRound?.votes.bob).toBeUndefined()
  })

  it('records votes but not while round is revealed', () => {
    let state = startState()
    const round = createRound({ id: 'r1', title: 't' })
    state = reducer(state, { type: 'ROUND_START', round })
    state = reducer(state, { type: 'VOTE', participantId: 'alice', value: '3' })
    expect(state.currentRound?.votes.alice).toBe('3')
    state = reducer(state, { type: 'REVEAL', by: 'alice', at: 100 })
    state = reducer(state, { type: 'VOTE', participantId: 'alice', value: '5' })
    expect(state.currentRound?.votes.alice).toBe('3')
  })

  it('clears a vote via UNVOTE', () => {
    let state = startState()
    const round = createRound({ id: 'r1', title: 't' })
    state = reducer(state, { type: 'ROUND_START', round })
    state = reducer(state, { type: 'VOTE', participantId: 'alice', value: '8' })
    state = reducer(state, { type: 'UNVOTE', participantId: 'alice' })
    expect(state.currentRound?.votes.alice).toBeUndefined()
  })

  it('pushes revealed rounds onto history when a new round starts', () => {
    let state = startState()
    const r1 = createRound({ id: 'r1', title: 'Story A' })
    state = reducer(state, { type: 'ROUND_START', round: r1 })
    state = reducer(state, { type: 'VOTE', participantId: 'alice', value: '5' })
    state = reducer(state, { type: 'REVEAL', by: 'alice', at: 10 })
    const r2 = createRound({ id: 'r2', title: 'Story B' })
    state = reducer(state, { type: 'ROUND_START', round: r2 })
    expect(state.history.map((r) => r.id)).toEqual(['r1'])
    expect(state.currentRound?.id).toBe('r2')
  })

  it('does not push an unrevealed round onto history (it gets replaced)', () => {
    let state = startState()
    const r1 = createRound({ id: 'r1', title: 'Story A' })
    state = reducer(state, { type: 'ROUND_START', round: r1 })
    const r2 = createRound({ id: 'r2', title: 'Story B' })
    state = reducer(state, { type: 'ROUND_START', round: r2 })
    expect(state.history).toHaveLength(0)
    expect(state.currentRound?.id).toBe('r2')
  })

  it('REVEAL is idempotent and preserves original reveal time', () => {
    let state = startState()
    const round = createRound({ id: 'r1', title: 't' })
    state = reducer(state, { type: 'ROUND_START', round })
    state = reducer(state, { type: 'REVEAL', by: 'alice', at: 10 })
    state = reducer(state, { type: 'REVEAL', by: 'bob', at: 99 })
    expect(state.currentRound?.revealedAt).toBe(10)
  })

  it('HELLO_SYNC merges participants and keeps the reveal sticky', () => {
    let local = startState()
    const round = createRound({ id: 'r1', title: 't' })
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

  it('PARTICIPANT_JOIN preserves the earliest joinedAt on reconnect', () => {
    let state = initialState('S')
    state = reducer(state, {
      type: 'PARTICIPANT_JOIN',
      participant: { id: 'alice', name: 'Alice', joinedAt: 100 },
    })
    state = reducer(state, {
      type: 'PARTICIPANT_JOIN',
      participant: { id: 'alice', name: 'Alice', joinedAt: 500 },
    })
    expect(state.participants.alice.joinedAt).toBe(100)
  })

  it('PARTICIPANT_RENAME updates name without touching joinedAt', () => {
    let state = initialState('S')
    state = reducer(state, {
      type: 'PARTICIPANT_JOIN',
      participant: { id: 'alice', name: 'Alice', joinedAt: 100 },
    })
    state = reducer(state, { type: 'PARTICIPANT_RENAME', participantId: 'alice', name: 'Ally' })
    expect(state.participants.alice.name).toBe('Ally')
    expect(state.participants.alice.joinedAt).toBe(100)
  })

  it('PARTICIPANT_RENAME is a no-op for unknown ids or unchanged names', () => {
    let state = initialState('S')
    state = reducer(state, {
      type: 'PARTICIPANT_JOIN',
      participant: { id: 'alice', name: 'Alice', joinedAt: 1 },
    })
    const missing = reducer(state, { type: 'PARTICIPANT_RENAME', participantId: 'bob', name: 'Bo' })
    expect(missing).toBe(state)
    const same = reducer(state, { type: 'PARTICIPANT_RENAME', participantId: 'alice', name: 'Alice' })
    expect(same).toBe(state)
  })

  it('ROUND_START with the same id merges votes instead of replacing', () => {
    let state = startState()
    const round = createRound({ id: 'r1', title: 't' })
    state = reducer(state, { type: 'ROUND_START', round })
    state = reducer(state, { type: 'VOTE', participantId: 'alice', value: '5' })
    // Simulate a late-delivered ROUND_START for the same round that already carries bob's vote.
    const replay: Round = { ...round, votes: { bob: '8' } }
    state = reducer(state, { type: 'ROUND_START', round: replay })
    expect(state.currentRound?.votes).toEqual({ alice: '5', bob: '8' })
  })

  it('ROUND_START resolves concurrent starts deterministically', () => {
    // Two peers start rounds at the same instant; both converge to the same winner
    // regardless of the order they see the ROUND_STARTs.
    const s0 = startState()
    const x = createRound({ id: 'r-x', title: 'x' })
    const y = createRound({ id: 'r-y', title: 'y' })
    // Force identical startedAt so tiebreak falls on id.
    const a: Round = { ...x, startedAt: 1000 }
    const b: Round = { ...y, startedAt: 1000 }

    const s1 = reducer(reducer(s0, { type: 'ROUND_START', round: a }), {
      type: 'ROUND_START',
      round: b,
    })
    const s2 = reducer(reducer(s0, { type: 'ROUND_START', round: b }), {
      type: 'ROUND_START',
      round: a,
    })
    expect(s1.currentRound?.id).toBe(s2.currentRound?.id)
    expect(s1.currentRound?.id).toBe('r-y') // lexicographic winner
  })

  it('HELLO_SYNC preserves min joinedAt across peers', () => {
    const local = reducer(initialState('S'), {
      type: 'PARTICIPANT_JOIN',
      participant: { id: 'alice', name: 'Alice', joinedAt: 500 },
    })
    const incoming = {
      ...local,
      participants: { alice: { id: 'alice', name: 'Alice', joinedAt: 100 } },
    }
    const synced = reducer(local, { type: 'HELLO_SYNC', state: incoming })
    expect(synced.participants.alice.joinedAt).toBe(100)
  })

  it('HELLO_SYNC merges remote history even when local round wins', () => {
    // Local has a newer unrevealed round. Remote has an older revealed round in history.
    let local = startState()
    const newer = createRound({ id: 'r-new', title: 'new' })
    local = reducer(local, { type: 'ROUND_START', round: { ...newer, startedAt: 2000 } })

    const older: Round = {
      id: 'r-old',
      title: 'old',
      startedAt: 1000,
      votes: { alice: '3' },
      revealed: true,
      revealedAt: 1500,
    }
    const incoming = { ...local, currentRound: older, history: [older] }
    const synced = reducer(local, { type: 'HELLO_SYNC', state: incoming })
    expect(synced.currentRound?.id).toBe('r-new')
    expect(synced.history.map((r) => r.id)).toContain('r-old')
  })
})

describe('pickNewerRound', () => {
  it('picks the later startedAt when they differ', () => {
    const a: Round = { id: 'a', title: '', startedAt: 100, votes: {}, revealed: false, revealedAt: null }
    const b: Round = { id: 'b', title: '', startedAt: 200, votes: {}, revealed: false, revealedAt: null }
    expect(pickNewerRound(a, b)).toBe(b)
    expect(pickNewerRound(b, a)).toBe(b)
  })

  it('tiebreaks on id when startedAt matches', () => {
    const a: Round = { id: 'aaa', title: '', startedAt: 100, votes: {}, revealed: false, revealedAt: null }
    const b: Round = { id: 'bbb', title: '', startedAt: 100, votes: {}, revealed: false, revealedAt: null }
    expect(pickNewerRound(a, b)).toBe(b)
    expect(pickNewerRound(b, a)).toBe(b)
  })
})

describe('computeDigest', () => {
  it('is deterministic for the same state', () => {
    const s = reducer(startState(), {
      type: 'ROUND_START',
      round: createRound({ id: 'r1', title: 'x' }),
    })
    const a = computeDigest(s)
    const b = computeDigest(s)
    expect(a.digest).toBe(b.digest)
  })

  it('converges across action reorderings', () => {
    // Two peers apply the same set of actions in different orders → same digest.
    const base = initialState('S')
    const a1 = reducer(base, { type: 'PARTICIPANT_JOIN', participant: participant('alice', 'Alice', 100) })
    const a2 = reducer(a1, { type: 'PARTICIPANT_JOIN', participant: participant('bob', 'Bob', 200) })

    const b1 = reducer(base, { type: 'PARTICIPANT_JOIN', participant: participant('bob', 'Bob', 200) })
    const b2 = reducer(b1, { type: 'PARTICIPANT_JOIN', participant: participant('alice', 'Alice', 100) })

    expect(computeDigest(a2).digest).toBe(computeDigest(b2).digest)
  })

  it('changes after any state-affecting action', () => {
    const s0 = startState()
    const before = computeDigest(s0).digest
    const s1 = reducer(s0, { type: 'ROUND_START', round: createRound({ id: 'r1', title: 'x' }) })
    expect(computeDigest(s1).digest).not.toBe(before)
  })

  it('reports a useful summary', () => {
    let s = startState()
    s = reducer(s, { type: 'ROUND_START', round: createRound({ id: 'r1', title: 'x' }) })
    s = reducer(s, { type: 'VOTE', participantId: 'alice', value: '5' })
    const { summary } = computeDigest(s)
    expect(summary.roundId).toBe('r1')
    expect(summary.voterCount).toBe(1)
    expect(summary.participantCount).toBe(2)
    expect(summary.revealed).toBe(false)
  })
})

describe('mergeParticipants', () => {
  it('unions ids and keeps min joinedAt', () => {
    const local = { alice: { id: 'alice', name: 'Alice', joinedAt: 500 } }
    const incoming = {
      alice: { id: 'alice', name: 'A', joinedAt: 100 },
      bob: { id: 'bob', name: 'Bob', joinedAt: 400 },
    }
    const merged = mergeParticipants(local, incoming)
    expect(Object.keys(merged).sort()).toEqual(['alice', 'bob'])
    expect(merged.alice.joinedAt).toBe(100)
    // Prefers the local name so in-flight renames aren't rolled back.
    expect(merged.alice.name).toBe('Alice')
    expect(merged.bob.joinedAt).toBe(400)
  })
})

describe('shouldAutoReveal', () => {
  it('is false with no round', () => {
    expect(shouldAutoReveal(initialState('S'))).toBe(false)
  })

  it('is false until every participant has voted', () => {
    let state = startState()
    const round = createRound({ id: 'r1', title: 't' })
    state = reducer(state, { type: 'ROUND_START', round })
    state = reducer(state, { type: 'VOTE', participantId: 'alice', value: '3' })
    expect(shouldAutoReveal(state)).toBe(false)
    state = reducer(state, { type: 'VOTE', participantId: 'bob', value: '5' })
    expect(shouldAutoReveal(state)).toBe(true)
  })

  it('returns false once the round is already revealed', () => {
    let state = startState()
    const round = createRound({ id: 'r1', title: 't' })
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
