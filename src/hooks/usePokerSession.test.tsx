import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePokerSession } from './usePokerSession'
import type { RoomTransport } from '../lib/room'
import type { Action } from '../lib/types'

/**
 * A tiny in-memory bus that lets us spin up two "clients" whose messages
 * reach each other synchronously. Used to drive usePokerSession without a
 * real WebRTC stack.
 */
class FakeBus {
  private transports = new Map<string, FakeTransport>()

  register(t: FakeTransport) {
    this.transports.set(t.selfId, t)
    // Defer join notifications so the hook has a chance to attach its
    // onAction/onPeerJoin handlers before peers start talking.
    queueMicrotask(() => {
      for (const other of this.transports.values()) {
        if (other.selfId !== t.selfId) {
          other.joinHandlers.forEach((h) => h(t.selfId))
          t.joinHandlers.forEach((h) => h(other.selfId))
        }
      }
    })
  }

  unregister(t: FakeTransport) {
    this.transports.delete(t.selfId)
    for (const other of this.transports.values()) {
      other.leaveHandlers.forEach((h) => h(t.selfId))
    }
  }

  send(from: string, action: Action, to?: string) {
    queueMicrotask(() => {
      for (const t of this.transports.values()) {
        if (t.selfId === from) continue
        if (to && t.selfId !== to) continue
        t.actionHandlers.forEach((h) => h(action, from))
      }
    })
  }
}

class FakeTransport implements RoomTransport {
  sessionId: string
  selfId: string
  actionHandlers = new Set<(action: Action, fromPeer: string) => void>()
  joinHandlers = new Set<(peerId: string) => void>()
  leaveHandlers = new Set<(peerId: string) => void>()

  constructor(sessionId: string, selfId: string, private bus: FakeBus) {
    this.sessionId = sessionId
    this.selfId = selfId
    bus.register(this)
  }

  send(action: Action) {
    this.bus.send(this.selfId, action)
  }
  sendTo(peerId: string, action: Action) {
    this.bus.send(this.selfId, action, peerId)
  }
  onAction(h: (action: Action, fromPeer: string) => void) {
    this.actionHandlers.add(h)
    return () => {
      this.actionHandlers.delete(h)
    }
  }
  onPeerJoin(h: (peerId: string) => void) {
    this.joinHandlers.add(h)
    return () => {
      this.joinHandlers.delete(h)
    }
  }
  onPeerLeave(h: (peerId: string) => void) {
    this.leaveHandlers.add(h)
    return () => {
      this.leaveHandlers.delete(h)
    }
  }
  async leave() {
    this.bus.unregister(this)
  }
}

const makePair = (sessionId: string) => {
  const bus = new FakeBus()
  let counter = 0
  const build = (name: string) => {
    const selfId = `peer-${++counter}`
    sessionStorage.setItem(`poker-self-${sessionId}`, selfId)
    return renderHook(() =>
      usePokerSession({
        sessionId,
        displayName: name,
        createTransport: () => new FakeTransport(sessionId, selfId, bus),
      }),
    )
  }
  return { bus, build }
}

describe('usePokerSession (integration against a fake transport)', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('registers the local participant right away', async () => {
    const { build } = makePair('S1')
    const { result } = build('Alice')
    await waitFor(() => {
      expect(Object.keys(result.current.state.participants)).toHaveLength(1)
    })
    expect(Object.values(result.current.state.participants)[0].name).toBe('Alice')
  })

  it('propagates votes and reveals across two clients', async () => {
    const bus = new FakeBus()
    sessionStorage.setItem('poker-self-S2', 'alice')
    const a = renderHook(() =>
      usePokerSession({
        sessionId: 'S2',
        displayName: 'Alice',
        createTransport: () => new FakeTransport('S2', 'alice', bus),
      }),
    )
    sessionStorage.setItem('poker-self-S2', 'bob')
    const b = renderHook(() =>
      usePokerSession({
        sessionId: 'S2',
        displayName: 'Bob',
        createTransport: () => new FakeTransport('S2', 'bob', bus),
      }),
    )

    await waitFor(() => {
      expect(Object.keys(a.result.current.state.participants).sort()).toEqual(['alice', 'bob'])
      expect(Object.keys(b.result.current.state.participants).sort()).toEqual(['alice', 'bob'])
    })

    act(() => a.result.current.startRound('Story 1'))
    await waitFor(() => {
      expect(b.result.current.state.currentRound?.title).toBe('Story 1')
    })

    act(() => a.result.current.vote('5'))
    act(() => b.result.current.vote('8'))

    // Both participants voted → auto-reveal should fire for everyone.
    await waitFor(() => {
      expect(a.result.current.state.currentRound?.revealed).toBe(true)
      expect(b.result.current.state.currentRound?.revealed).toBe(true)
    })

    expect(a.result.current.state.currentRound?.votes).toEqual({ alice: '5', bob: '8' })
  })

  it('force-reveal propagates even without all votes', async () => {
    const bus = new FakeBus()
    sessionStorage.setItem('poker-self-S3', 'alice')
    const a = renderHook(() =>
      usePokerSession({
        sessionId: 'S3',
        displayName: 'Alice',
        createTransport: () => new FakeTransport('S3', 'alice', bus),
      }),
    )
    sessionStorage.setItem('poker-self-S3', 'bob')
    const b = renderHook(() =>
      usePokerSession({
        sessionId: 'S3',
        displayName: 'Bob',
        createTransport: () => new FakeTransport('S3', 'bob', bus),
      }),
    )

    await waitFor(() => {
      expect(Object.keys(a.result.current.state.participants)).toHaveLength(2)
    })

    act(() => a.result.current.startRound('Story'))
    await waitFor(() => {
      expect(b.result.current.state.currentRound).not.toBeNull()
    })
    act(() => a.result.current.vote('5'))
    act(() => a.result.current.reveal())

    await waitFor(() => {
      expect(b.result.current.state.currentRound?.revealed).toBe(true)
    })
  })
})
