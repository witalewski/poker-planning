import { useEffect, useState } from 'react'
import { HomePage } from './pages/HomePage'
import { SessionPage } from './pages/SessionPage'
import { isValidSessionCode, normalizeSessionCode } from './lib/codes'
import './App.css'

interface Route {
  view: 'home' | 'session'
  sessionId?: string
}

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (hash.startsWith('session/')) {
    const raw = hash.slice('session/'.length)
    const code = normalizeSessionCode(raw)
    if (isValidSessionCode(code)) return { view: 'session', sessionId: code }
  }
  return { view: 'home' }
}

function App() {
  const [route, setRoute] = useState<Route>(parseHash)
  const [displayName, setDisplayName] = useState<string>(() => {
    return localStorage.getItem('poker-display-name') ?? ''
  })

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigateToSession = (code: string, name: string) => {
    localStorage.setItem('poker-display-name', name)
    setDisplayName(name)
    window.location.hash = `/session/${code}`
  }

  const navigateHome = () => {
    window.location.hash = ''
  }

  return (
    <div className="app-shell">
      <div className="grid-bg" aria-hidden="true" />
      <div className="glow-orb glow-orb-a" aria-hidden="true" />
      <div className="glow-orb glow-orb-b" aria-hidden="true" />
      {route.view === 'home' && (
        <HomePage onEnter={navigateToSession} initialName={displayName} />
      )}
      {route.view === 'session' && route.sessionId && (
        <SessionPage
          sessionId={route.sessionId}
          displayName={displayName}
          onSetName={(n) => {
            localStorage.setItem('poker-display-name', n)
            setDisplayName(n)
          }}
          onLeave={navigateHome}
        />
      )}
    </div>
  )
}

export default App
