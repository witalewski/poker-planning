import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePokerSession } from './usePokerSession'
import type { RoomTransport } from '../lib/room'
import type { ActionEnvelope } from '../lib/types'

/**
 * A tiny in-memory bus that lets us spin up two "clients" whose messages
 * reach each other synchronously. Used to drive usePokerSession without a
 * real WebRTC stack.
 */
class FakeBus {
  private transports = new Map<string, FakeTransport>()
  /** Optional filter; return false to drop the delivery. */
  deliverFilter: ((from: string, envelope: ActionEnvelope, to: string) => boolean) | null = null

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

  send(from: string, envelope: ActionEnvelope, to?: string) {
    queueMicrotask(() => {
      for (const t of this.transports.values()) {
        if (t.selfId === from) continue
        if (to && t.selfId !== to) continue
        if (this.deliverFilter && !this.deliverFilter(from, envelope, t.selfId)) continue
        t.actionHandlers.forEach((h) => h(envelope, from))
      }
    })
  }
}

class FakeTransport implements RoomTransport {
  sessionId: string
  selfId: string
  actionHandlers = new Set<(envelope: ActionEnvelope, fromPeer: string) => void>()
  joinHandlers = new Set<(peerId: string) => void>()
  leaveHandlers = new Set<(peerId: string) => void>()

  constructor(sessionId: string, selfId: string, private bus: FakeBus) {
    this.sessionId = sessionId
    this.selfId = selfId
    bus.register(this)
  }

  send(envelope: ActionEnvelope) {
    this.bus.send(this.selfId, envelope)
  }
  sendTo(peerId: string, envelope: ActionEnvelope) {
    this.bus.send(this.selfId, envelope, peerId)
  }
  onAction(h: (envelope: ActionEnvelope, fromPeer: string) => void) {
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
    localStorage.clear()
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

  it('restores round state from the local snapshot on a bare rejoin', async () => {
    const busA = new FakeBus()
    sessionStorage.setItem('poker-self-Z1', 'alice')

    // First visit: Alice starts a round, waits for the snapshot write, then closes the tab.
    const first = renderHook(() =>
      usePokerSession({
        sessionId: 'Z1',
        displayName: 'Alice',
        createTransport: () => new FakeTransport('Z1', 'alice', busA),
        digestIntervalMs: 10_000,
      }),
    )
    await waitFor(() => {
      expect(Object.keys(first.result.current.state.participants)).toContain('alice')
    })
    act(() => first.result.current.startRound('Persisted story'))
    // Give the debounced snapshot writer time to flush.
    await new Promise((r) => setTimeout(r, 600))
    // Tab-close semantics: unmount without calling session.leave().
    first.unmount()

    // Second visit: fresh bus (no peers), same sessionId. Snapshot should hydrate.
    const busB = new FakeBus()
    sessionStorage.setItem('poker-self-Z1', 'alice')
    const second = renderHook(() =>
      usePokerSession({
        sessionId: 'Z1',
        displayName: 'Alice',
        createTransport: () => new FakeTransport('Z1', 'alice', busB),
        digestIntervalMs: 10_000,
      }),
    )

    await waitFor(() => {
      expect(second.result.current.state.currentRound?.title).toBe('Persisted story')
    })
  })

  it('clearing the snapshot on explicit leave prevents auto-restore', async () => {
    const bus = new FakeBus()
    sessionStorage.setItem('poker-self-Z2', 'alice')
    const first = renderHook(() =>
      usePokerSession({
        sessionId: 'Z2',
        displayName: 'Alice',
        createTransport: () => new FakeTransport('Z2', 'alice', bus),
        digestIntervalMs: 10_000,
      }),
    )
    await waitFor(() => {
      expect(Object.keys(first.result.current.state.participants)).toContain('alice')
    })
    act(() => first.result.current.startRound('Doomed story'))
    await new Promise((r) => setTimeout(r, 600))

    await act(async () => {
      await first.result.current.leave()
      first.unmount()
    })

    const bus2 = new FakeBus()
    sessionStorage.setItem('poker-self-Z2', 'alice')
    const second = renderHook(() =>
      usePokerSession({
        sessionId: 'Z2',
        displayName: 'Alice',
        createTransport: () => new FakeTransport('Z2', 'alice', bus2),
        digestIntervalMs: 10_000,
      }),
    )
    await waitFor(() => {
      expect(Object.keys(second.result.current.state.participants)).toContain('alice')
    })
    // Round was cleared by explicit leave → fresh session.
    expect(second.result.current.state.currentRound).toBeNull()
  })

  it('self-heals after a dropped broadcast via digest-driven resync', async () => {
    const bus = new FakeBus()

    sessionStorage.setItem('poker-self-S6', 'alice')
    const a = renderHook(() =>
      usePokerSession({
        sessionId: 'S6',
        displayName: 'Alice',
        createTransport: () => new FakeTransport('S6', 'alice', bus),
        digestIntervalMs: 40,
        resyncCooldownMs: 0,
      }),
    )
    sessionStorage.setItem('poker-self-S6', 'bob')
    const b = renderHook(() =>
      usePokerSession({
        sessionId: 'S6',
        displayName: 'Bob',
        createTransport: () => new FakeTransport('S6', 'bob', bus),
        digestIntervalMs: 40,
        resyncCooldownMs: 0,
      }),
    )

    await waitFor(() => {
      expect(Object.keys(a.result.current.state.participants)).toHaveLength(2)
      expect(Object.keys(b.result.current.state.participants)).toHaveLength(2)
    })

    // Drop the first ROUND_START from alice → bob.
    let droppedOnce = false
    bus.deliverFilter = (from, envelope, to) => {
      if (
        from === 'alice' &&
        to === 'bob' &&
        !droppedOnce &&
        envelope.action.type === 'ROUND_START'
      ) {
        droppedOnce = true
        return false
      }
      return true
    }

    act(() => a.result.current.startRound('Dropped story'))

    // Alice applies locally; Bob does not see ROUND_START. After a digest tick,
    // bob notices the mismatch and pulls a HELLO_SYNC.
    await waitFor(
      () => {
        expect(b.result.current.state.currentRound?.title).toBe('Dropped story')
      },
      { timeout: 2000 },
    )
  })

  it('any remaining peer can force-reveal after the starter leaves', async () => {
    const bus = new FakeBus()
    sessionStorage.setItem('poker-self-S4', 'alice')
    const a = renderHook(() =>
      usePokerSession({
        sessionId: 'S4',
        displayName: 'Alice',
        createTransport: () => new FakeTransport('S4', 'alice', bus),
      }),
    )
    sessionStorage.setItem('poker-self-S4', 'bob')
    const b = renderHook(() =>
      usePokerSession({
        sessionId: 'S4',
        displayName: 'Bob',
        createTransport: () => new FakeTransport('S4', 'bob', bus),
      }),
    )
    sessionStorage.setItem('poker-self-S4', 'carol')
    const c = renderHook(() =>
      usePokerSession({
        sessionId: 'S4',
        displayName: 'Carol',
        createTransport: () => new FakeTransport('S4', 'carol', bus),
      }),
    )

    await waitFor(() => {
      expect(Object.keys(a.result.current.state.participants)).toHaveLength(3)
      expect(Object.keys(b.result.current.state.participants)).toHaveLength(3)
      expect(Object.keys(c.result.current.state.participants)).toHaveLength(3)
    })

    act(() => a.result.current.startRound('Story'))
    await waitFor(() => {
      expect(b.result.current.state.currentRound).not.toBeNull()
      expect(c.result.current.state.currentRound).not.toBeNull()
    })

    act(() => a.result.current.vote('5'))
    // Alice disconnects before Bob and Carol vote.
    await act(async () => {
      await a.result.current.leave()
      a.unmount()
    })

    await waitFor(() => {
      expect(Object.keys(b.result.current.state.participants)).not.toContain('alice')
    })

    // Bob (not the starter) force-reveals — used to be impossible.
    act(() => b.result.current.reveal())

    await waitFor(() => {
      expect(b.result.current.state.currentRound?.revealed).toBe(true)
      expect(c.result.current.state.currentRound?.revealed).toBe(true)
    })
  })

  it('drops duplicate envelopes from the same origin by seq', async () => {
    const bus = new FakeBus()
    sessionStorage.setItem('poker-self-S5', 'bob')
    const b = renderHook(() =>
      usePokerSession({
        sessionId: 'S5',
        displayName: 'Bob',
        createTransport: () => new FakeTransport('S5', 'bob', bus),
      }),
    )

    // Simulate Alice's transport arriving and sending the same envelope twice.
    const alice = new FakeTransport('S5', 'alice', bus)
    alice.send({
      action: {
        type: 'PARTICIPANT_JOIN',
        participant: { id: 'alice', name: 'Alice', joinedAt: 1 },
      },
      originId: 'alice',
      seq: 1,
    })
    await waitFor(() => {
      expect(Object.keys(b.result.current.state.participants)).toContain('alice')
    })

    const round = {
      id: 'r1',
      title: 'Dedupe test',
      startedAt: 10,
      votes: {},
      revealed: false,
      revealedAt: null,
    }
    const env: ActionEnvelope = {
      action: { type: 'ROUND_START', round },
      originId: 'alice',
      seq: 99,
    }
    alice.send(env)
    alice.send(env) // duplicate with identical seq

    await waitFor(() => {
      expect(b.result.current.state.currentRound?.id).toBe('r1')
    })

    // A duplicate VOTE should also be suppressed: cast two identical envelopes.
    const voteEnv: ActionEnvelope = {
      action: { type: 'VOTE', participantId: 'alice', value: '5' },
      originId: 'alice',
      seq: 100,
    }
    alice.send(voteEnv)
    alice.send(voteEnv)
    await waitFor(() => {
      expect(b.result.current.state.currentRound?.votes.alice).toBe('5')
    })
    // If dedupe works we still only recorded one vote.
    expect(Object.keys(b.result.current.state.currentRound?.votes ?? {})).toHaveLength(1)
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
