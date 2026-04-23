import { useState, type FormEvent } from 'react'
import { generateSessionCode, isValidSessionCode, normalizeSessionCode } from '../lib/codes'

interface HomePageProps {
  onEnter: (code: string, name: string) => void
  initialName: string
}

export function HomePage({ onEnter, initialName }: HomePageProps) {
  const [name, setName] = useState(initialName)
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleCreate = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Enter your name to continue.')
      return
    }
    const code = generateSessionCode()
    onEnter(code, trimmedName)
  }

  const handleJoin = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Enter your name to continue.')
      return
    }
    const code = normalizeSessionCode(joinCode)
    if (!isValidSessionCode(code)) {
      setError('That session code looks wrong. Codes are 6 letters/digits.')
      return
    }
    onEnter(code, trimmedName)
  }

  return (
    <main className="home">
      <header className="home-hero">
        <div className="home-logo" aria-hidden="true">
          <span className="logo-chip">♠</span>
          <span className="logo-chip">♥</span>
          <span className="logo-chip">♦</span>
          <span className="logo-chip">♣</span>
        </div>
        <h1 className="home-title">
          <span className="neon-pink">Neon</span> <span className="neon-cyan">Poker</span>
        </h1>
        <p className="home-sub">Serverless sprint planning that runs on pure peer-to-peer magic.</p>
      </header>

      <section className="home-cards">
        <form className="panel panel-pink" onSubmit={handleCreate} aria-label="Create session">
          <h2>Create a session</h2>
          <p>Spin up a fresh room and invite the team.</p>
          <label>
            <span>Your name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ada Lovelace"
              maxLength={30}
              autoComplete="off"
              data-testid="display-name-input"
            />
          </label>
          <button type="submit" className="neon-btn neon-btn-pink" data-testid="create-session-button">
            Launch ▶
          </button>
        </form>

        <form className="panel panel-cyan" onSubmit={handleJoin} aria-label="Join session">
          <h2>Join a session</h2>
          <p>Got a code? Drop it here and slide in.</p>
          <label>
            <span>Session code</span>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
              autoComplete="off"
              spellCheck={false}
              className="code-input"
              data-testid="join-code-input"
            />
          </label>
          <button type="submit" className="neon-btn neon-btn-cyan" data-testid="join-session-button">
            Enter ⇥
          </button>
        </form>
      </section>

      {error && (
        <div role="alert" className="error-flash" data-testid="home-error">
          {error}
        </div>
      )}

      <footer className="home-footer">
        <span className="pulse-dot" /> P2P over WebRTC · no servers · your votes never leave your devices
      </footer>
    </main>
  )
}
