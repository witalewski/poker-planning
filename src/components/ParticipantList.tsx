import type { SessionState } from '../lib/types'
import { CyberpunkDuck } from './CyberpunkDuck'

interface Props {
  state: SessionState
  selfId: string
}

export function ParticipantList({ state, selfId }: Props) {
  const round = state.currentRound
  const sorted = Object.values(state.participants).sort((a, b) => a.joinedAt - b.joinedAt)

  return (
    <ul className="participant-list" data-testid="participant-list">
      {sorted.map((p) => {
        const hasVote = round ? round.votes[p.id] !== undefined : false
        const revealed = round?.revealed ?? false
        const vote = hasVote && revealed ? round!.votes[p.id] : null
        const isSelf = p.id === selfId
        return (
          <li
            key={p.id}
            className={`participant ${hasVote ? 'has-vote' : ''} ${revealed ? 'revealed' : ''}`}
            data-testid={`participant-${p.id}`}
            data-has-vote={hasVote ? 'true' : 'false'}
          >
            <span className="participant-avatar" aria-hidden="true">
              <CyberpunkDuck seed={p.id || p.name} />
            </span>
            <span className="participant-name">
              {p.name}
              {isSelf && <span className="self-tag"> · you</span>}
            </span>
            <span className="participant-status">
              {!round && <span className="status-idle">idle</span>}
              {round && !revealed && (
                hasVote ? (
                  <span className="status-voted" aria-label="voted">✓</span>
                ) : (
                  <span className="status-thinking" aria-label="thinking">…</span>
                )
              )}
              {round && revealed && (
                <span className="participant-card" data-testid={`revealed-vote-${p.id}`}>
                  {vote ?? '—'}
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
