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
  startedBy: string
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
  | { type: 'ROUND_START'; round: Round }
  | { type: 'VOTE'; participantId: string; value: CardValue }
  | { type: 'UNVOTE'; participantId: string }
  | { type: 'REVEAL'; by: string; at: number }
  | { type: 'HELLO_SYNC'; state: SessionState }
