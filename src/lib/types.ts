export const CARD_VALUES = ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?'] as const
export type CardValue = (typeof CARD_VALUES)[number]

export interface Participant {
  id: string
  name: string
  joinedAt: number
}

export interface Round {
  id: string
  title: string
  startedAt: number
  votes: Record<string, CardValue>
  revealed: boolean
  revealedAt: number | null
}

export interface SessionState {
  sessionId: string
  participants: Record<string, Participant>
  currentRound: Round | null
  history: Round[]
}

export type Action =
  | { type: 'PARTICIPANT_JOIN'; participant: Participant }
  | { type: 'PARTICIPANT_LEAVE'; participantId: string }
  | { type: 'PARTICIPANT_RENAME'; participantId: string; name: string }
  | { type: 'ROUND_START'; round: Round }
  | { type: 'VOTE'; participantId: string; value: CardValue }
  | { type: 'UNVOTE'; participantId: string }
  | { type: 'REVEAL'; by: string; at: number }
  | { type: 'HELLO_SYNC'; state: SessionState }

export interface DigestSummary {
  roundId: string | null
  voterCount: number
  revealed: boolean
  historyLen: number
  participantCount: number
}

/**
 * Control messages that cross the wire but are not dispatched through the reducer.
 * `STATE_DIGEST` is a periodic broadcast used for anti-entropy; `REQUEST_SYNC`
 * asks a specific peer to respond with a fresh HELLO_SYNC.
 */
export type ControlAction =
  | { type: 'STATE_DIGEST'; digest: string; summary: DigestSummary }
  | { type: 'REQUEST_SYNC'; reason: 'digest-mismatch' | 'startup' }

export type TransportAction = Action | ControlAction

/**
 * Transport-layer envelope that carries every action (reducer or control)
 * across the mesh. `originId` identifies the authoring peer; `seq` is a
 * per-origin monotonic counter used for duplicate suppression.
 */
export interface ActionEnvelope {
  action: TransportAction
  originId: string
  seq: number
}
