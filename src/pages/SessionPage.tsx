import { useState, type FormEvent } from 'react'
import { usePokerSession } from '../hooks/usePokerSession'
import { CardDeck } from '../components/CardDeck'
import { ParticipantList } from '../components/ParticipantList'
import { RevealedSummary } from '../components/RevealedSummary'
import type { CardValue } from '../lib/types'

interface SessionPageProps {
  sessionId: string
  displayName: string
  onSetName: (name: string) => void
  onLeave: () => void
}

export function SessionPage({ sessionId, displayName, onSetName, onLeave }: SessionPageProps) {
  if (!displayName) {
    return <NamePrompt onSubmit={onSetName} />
  }
  return (
    <ActiveSession
      sessionId={sessionId}
      displayName={displayName}
      onLeave={onLeave}
    />
  )
}

function NamePrompt({ onSubmit }: { onSubmit: (n: string) => void }) {
  const [name, setName] = useState('')
  return (
    <main className="home">
      <header className="home-hero">
        <h1 className="home-title">
          <span className="neon-cyan">Who's</span> <span className="neon-pink">playing?</span>
        </h1>
      </header>
      <form
        className="panel panel-cyan"
        style={{ maxWidth: 400, margin: '0 auto' }}
        onSubmit={(e) => {
          e.preventDefault()
          const t = name.trim()
          if (t) onSubmit(t)
        }}
      >
        <label>
          <span>Your name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={30}
            data-testid="display-name-input"
          />
        </label>
        <button type="submit" className="neon-btn neon-btn-cyan">
          Join
        </button>
      </form>
    </main>
  )
}

function ActiveSession({
  sessionId,
  displayName,
  onLeave,
}: {
  sessionId: string
  displayName: string
  onLeave: () => void
}) {
  const session = usePokerSession({ sessionId, displayName })
  const [newRoundTitle, setNewRoundTitle] = useState('')
  const [copied, setCopied] = useState(false)

  const { state, selfId } = session
  const round = state.currentRound
  const myVote: CardValue | undefined = round?.votes[selfId]
  const isRoundStarter = round?.startedBy === selfId
  const participantCount = Object.keys(state.participants).length

  const startRound = (e: FormEvent) => {
    e.preventDefault()
    session.startRound(newRoundTitle.trim() || 'Untitled round')
    setNewRoundTitle('')
  }

  const copyShareLink = async () => {
    try {
      const url = `${window.location.origin}${window.location.pathname}#/session/${sessionId}`
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  const leave = async () => {
    await session.leave()
    onLeave()
  }

  return (
    <main className="session">
      <header className="session-top">
        <div>
          <h1 className="session-title">
            <span className="neon-pink">Neon</span> <span className="neon-cyan">Poker</span>
          </h1>
          <div className="session-code-row">
            <span className="session-label">Session</span>
            <code className="session-code" data-testid="session-code">{sessionId}</code>
            <button
              type="button"
              className="ghost-btn"
              onClick={copyShareLink}
              data-testid="copy-link-button"
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        </div>
        <button type="button" className="ghost-btn" onClick={leave} data-testid="leave-button">
          Leave
        </button>
      </header>

      <section className="session-main">
        <aside className="sidebar">
          <h2 className="sidebar-title">
            Crew <span className="count-pill">{participantCount}</span>
          </h2>
          <ParticipantList
            state={state}
            selfId={selfId}
          />
        </aside>

        <section className="stage">
          {!round && (
            <div className="stage-empty">
              <div className="stage-empty-art" aria-hidden="true">
                <div className="empty-card" />
                <div className="empty-card" />
                <div className="empty-card" />
              </div>
              <h2>No active round</h2>
              <p>Kick off the first story to start voting.</p>
              <form onSubmit={startRound} className="start-round-form">
                <input
                  type="text"
                  placeholder="Round title (optional)"
                  value={newRoundTitle}
                  onChange={(e) => setNewRoundTitle(e.target.value)}
                  maxLength={80}
                  data-testid="round-title-input"
                />
                <button type="submit" className="neon-btn neon-btn-pink" data-testid="start-round-button">
                  Start round ▶
                </button>
              </form>
            </div>
          )}

          {round && !round.revealed && (
            <div className="round-active">
              <div className="round-header">
                <div>
                  <span className="eyebrow">Round in progress</span>
                  <h2 className="round-title" data-testid="round-title">{round.title}</h2>
                </div>
                <div className="round-actions">
                  {isRoundStarter && (
                    <button
                      type="button"
                      className="neon-btn neon-btn-cyan"
                      onClick={() => session.reveal()}
                      data-testid="reveal-button"
                    >
                      Force reveal
                    </button>
                  )}
                </div>
              </div>

              <p className="round-sub">
                Pick your card. Nobody sees what you picked until the reveal.
              </p>

              <CardDeck selected={myVote} onSelect={(v) => session.vote(v)} onClear={() => session.unvote()} />
            </div>
          )}

          {round && round.revealed && (
            <div className="round-revealed">
              <div className="round-header">
                <div>
                  <span className="eyebrow">Results</span>
                  <h2 className="round-title" data-testid="round-title">{round.title}</h2>
                </div>
                <form onSubmit={startRound} className="start-round-form inline">
                  <input
                    type="text"
                    placeholder="Next round title"
                    value={newRoundTitle}
                    onChange={(e) => setNewRoundTitle(e.target.value)}
                    maxLength={80}
                    data-testid="next-round-title-input"
                  />
                  <button type="submit" className="neon-btn neon-btn-pink" data-testid="next-round-button">
                    New round ▶
                  </button>
                </form>
              </div>

              <RevealedSummary round={round} state={state} />
            </div>
          )}
        </section>
      </section>
    </main>
  )
}
