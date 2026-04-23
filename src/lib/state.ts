import type { Action, Round, SessionState, CardValue } from './types'

export function initialState(sessionId: string): SessionState {
  return {
    sessionId,
    participants: {},
    currentRound: null,
    history: [],
  }
}

export function createRound(params: { title: string; startedBy: string; id: string }): Round {
  return {
    id: params.id,
    title: params.title,
    startedBy: params.startedBy,
    startedAt: Date.now(),
    votes: {},
    revealed: false,
    revealedAt: null,
  }
}

export function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'PARTICIPANT_JOIN': {
      if (state.participants[action.participant.id]) return state
      return {
        ...state,
        participants: { ...state.participants, [action.participant.id]: action.participant },
      }
    }
    case 'PARTICIPANT_LEAVE': {
      if (!state.participants[action.participantId]) return state
      const next = { ...state.participants }
      delete next[action.participantId]
      // Remove the participant's vote from the current round so auto-reveal can still trigger.
      let currentRound = state.currentRound
      if (currentRound && currentRound.votes[action.participantId] !== undefined) {
        const nextVotes = { ...currentRound.votes }
        delete nextVotes[action.participantId]
        currentRound = { ...currentRound, votes: nextVotes }
      }
      return { ...state, participants: next, currentRound }
    }
    case 'ROUND_START': {
      const history = state.currentRound && state.currentRound.revealed
        ? [...state.history, state.currentRound]
        : state.history
      return { ...state, currentRound: action.round, history }
    }
    case 'VOTE': {
      if (!state.currentRound) return state
      if (state.currentRound.revealed) return state
      const votes = { ...state.currentRound.votes, [action.participantId]: action.value }
      return { ...state, currentRound: { ...state.currentRound, votes } }
    }
    case 'UNVOTE': {
      if (!state.currentRound || state.currentRound.revealed) return state
      if (state.currentRound.votes[action.participantId] === undefined) return state
      const votes = { ...state.currentRound.votes }
      delete votes[action.participantId]
      return { ...state, currentRound: { ...state.currentRound, votes } }
    }
    case 'REVEAL': {
      if (!state.currentRound) return state
      if (state.currentRound.revealed) return state
      return {
        ...state,
        currentRound: { ...state.currentRound, revealed: true, revealedAt: action.at },
      }
    }
    case 'HELLO_SYNC': {
      // Merge: newer rounds win, union participants. Simple strategy: take incoming state as truth
      // when it is ahead (more participants or more history). Preserves local self identity.
      const incoming = action.state
      if (incoming.sessionId !== state.sessionId) return state
      const mergedParticipants = { ...incoming.participants, ...state.participants }
      // Prefer incoming currentRound if local has none, or if incoming is newer.
      let currentRound = state.currentRound
      if (!currentRound && incoming.currentRound) currentRound = incoming.currentRound
      else if (
        incoming.currentRound &&
        state.currentRound &&
        incoming.currentRound.startedAt > state.currentRound.startedAt
      ) {
        currentRound = incoming.currentRound
      } else if (
        incoming.currentRound &&
        state.currentRound &&
        incoming.currentRound.id === state.currentRound.id
      ) {
        // Same round: merge votes and revealed flag (once revealed, stays revealed).
        currentRound = {
          ...state.currentRound,
          votes: { ...state.currentRound.votes, ...incoming.currentRound.votes },
          revealed: state.currentRound.revealed || incoming.currentRound.revealed,
          revealedAt: state.currentRound.revealedAt ?? incoming.currentRound.revealedAt,
        }
      }
      const history = mergeHistory(state.history, incoming.history)
      return { ...state, participants: mergedParticipants, currentRound, history }
    }
    default:
      return state
  }
}

function mergeHistory(a: Round[], b: Round[]): Round[] {
  const byId = new Map<string, Round>()
  for (const r of [...a, ...b]) {
    const existing = byId.get(r.id)
    if (!existing) byId.set(r.id, r)
    else if (r.revealed && !existing.revealed) byId.set(r.id, r)
  }
  return Array.from(byId.values()).sort((x, y) => x.startedAt - y.startedAt)
}

/**
 * If every known participant has cast a vote, the round should be auto-revealed.
 * Returns true when the caller should dispatch a REVEAL action.
 */
export function shouldAutoReveal(state: SessionState): boolean {
  if (!state.currentRound || state.currentRound.revealed) return false
  const participantIds = Object.keys(state.participants)
  if (participantIds.length === 0) return false
  return participantIds.every((pid) => state.currentRound!.votes[pid] !== undefined)
}

export interface VoteSummary {
  count: number
  average: number | null
  median: number | null
  mode: CardValue | null
  distribution: Array<{ value: CardValue; count: number }>
  consensus: boolean
  questionCount: number
}

export function summarize(round: Round): VoteSummary {
  const values = Object.values(round.votes)
  const distMap = new Map<CardValue, number>()
  for (const v of values) distMap.set(v, (distMap.get(v) ?? 0) + 1)
  const distribution = Array.from(distMap.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)

  const numeric = values.filter((v): v is Exclude<CardValue, '?'> => v !== '?').map((v) => parseInt(v, 10))
  const questionCount = values.length - numeric.length

  const average = numeric.length > 0 ? +(numeric.reduce((s, n) => s + n, 0) / numeric.length).toFixed(2) : null
  const median = numeric.length > 0 ? computeMedian(numeric) : null

  let mode: CardValue | null = null
  if (distribution.length > 0 && distribution[0].count > 0) {
    mode = distribution[0].value
  }

  const consensus = numeric.length > 0 && new Set(numeric).size === 1 && questionCount === 0

  return {
    count: values.length,
    average,
    median,
    mode,
    distribution,
    consensus,
    questionCount,
  }
}

function computeMedian(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const val = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  return +val.toFixed(2)
}
