import type { Action, Round, SessionState, CardValue, Participant, DigestSummary } from './types'

export function initialState(sessionId: string): SessionState {
  return {
    sessionId,
    participants: {},
    currentRound: null,
    history: [],
  }
}

export function createRound(params: { title: string; id: string }): Round {
  return {
    id: params.id,
    title: params.title,
    startedAt: Date.now(),
    votes: {},
    revealed: false,
    revealedAt: null,
  }
}

export function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'PARTICIPANT_JOIN': {
      const existing = state.participants[action.participant.id]
      if (existing) {
        // Preserve the earliest joinedAt across reconnects so crew order stays stable.
        const joinedAt = Math.min(existing.joinedAt, action.participant.joinedAt)
        if (joinedAt === existing.joinedAt) return state
        return {
          ...state,
          participants: {
            ...state.participants,
            [action.participant.id]: { ...existing, joinedAt },
          },
        }
      }
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
    case 'PARTICIPANT_RENAME': {
      const existing = state.participants[action.participantId]
      if (!existing || existing.name === action.name) return state
      return {
        ...state,
        participants: {
          ...state.participants,
          [action.participantId]: { ...existing, name: action.name },
        },
      }
    }
    case 'ROUND_START': {
      // Same round id → merge votes + sticky reveal. Idempotent under replay.
      if (state.currentRound && state.currentRound.id === action.round.id) {
        const merged: Round = {
          ...state.currentRound,
          votes: { ...action.round.votes, ...state.currentRound.votes },
          revealed: state.currentRound.revealed || action.round.revealed,
          revealedAt: state.currentRound.revealedAt ?? action.round.revealedAt,
        }
        return { ...state, currentRound: merged }
      }
      // Concurrent starts: keep the lexicographic winner so every peer converges.
      if (state.currentRound && !state.currentRound.revealed) {
        if (pickNewerRound(state.currentRound, action.round) === state.currentRound) {
          return state
        }
      }
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
      const incoming = action.state
      if (incoming.sessionId !== state.sessionId) return state
      const mergedParticipants = mergeParticipants(state.participants, incoming.participants)
      let currentRound = state.currentRound
      if (!currentRound) {
        currentRound = incoming.currentRound
      } else if (incoming.currentRound) {
        if (incoming.currentRound.id === currentRound.id) {
          currentRound = {
            ...currentRound,
            votes: { ...incoming.currentRound.votes, ...currentRound.votes },
            revealed: currentRound.revealed || incoming.currentRound.revealed,
            revealedAt: currentRound.revealedAt ?? incoming.currentRound.revealedAt,
          }
        } else {
          currentRound = pickNewerRound(currentRound, incoming.currentRound)
        }
      }
      const history = mergeHistory(state.history, incoming.history)
      return { ...state, participants: mergedParticipants, currentRound, history }
    }
    default:
      return state
  }
}

/**
 * Deterministic tiebreak between two rounds. Lexicographic on (startedAt, id)
 * so peers with skewed clocks still converge on the same winner.
 */
export function pickNewerRound(a: Round, b: Round): Round {
  if (a.startedAt !== b.startedAt) return a.startedAt > b.startedAt ? a : b
  return a.id > b.id ? a : b
}

/**
 * Union of participant maps, preserving the earliest joinedAt per id and
 * preferring the local name (incoming may be stale during rename propagation).
 */
export function mergeParticipants(
  local: Record<string, Participant>,
  incoming: Record<string, Participant>,
): Record<string, Participant> {
  const out: Record<string, Participant> = { ...incoming }
  for (const [id, p] of Object.entries(local)) {
    const inc = out[id]
    if (!inc) {
      out[id] = p
    } else {
      out[id] = { ...p, joinedAt: Math.min(p.joinedAt, inc.joinedAt) }
    }
  }
  return out
}

/**
 * Canonical, deterministic digest of session state. Two peers that have
 * applied the same set of actions (in any order) produce the same digest;
 * any divergence changes it. Used for anti-entropy.
 */
export function computeDigest(state: SessionState): { digest: string; summary: DigestSummary } {
  const round = state.currentRound
  const participants = Object.values(state.participants)
    .map((p) => [p.id, p.joinedAt, p.name] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const votesSorted = round
    ? Object.entries(round.votes).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    : []
  const historyIds = state.history.map((r) => r.id).slice().sort()

  const canonical = JSON.stringify({
    round: round
      ? { id: round.id, revealed: round.revealed, revealedAt: round.revealedAt, votes: votesSorted }
      : null,
    participants,
    historyIds,
  })

  const summary: DigestSummary = {
    roundId: round?.id ?? null,
    voterCount: round ? Object.keys(round.votes).length : 0,
    revealed: round?.revealed ?? false,
    historyLen: state.history.length,
    participantCount: participants.length,
  }

  return { digest: fnv1a(canonical), summary }
}

/** FNV-1a 32-bit hash, returned as a hex string. Deterministic, no crypto needed. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
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
