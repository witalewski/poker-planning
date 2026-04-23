import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createRoom, type RoomTransport } from '../lib/room'
import { generateRoundId } from '../lib/codes'
import { computeDigest, initialState, reducer, createRound, shouldAutoReveal } from '../lib/state'
import { clearSnapshot, readSnapshot, writeSnapshot } from '../lib/persist'
import type {
  Action,
  ActionEnvelope,
  CardValue,
  ControlAction,
  Participant,
  SessionState,
  TransportAction,
} from '../lib/types'

function isControlAction(action: TransportAction): action is ControlAction {
  return action.type === 'STATE_DIGEST' || action.type === 'REQUEST_SYNC'
}

export interface PokerSessionHandle {
  state: SessionState
  selfId: string
  peers: string[]
  startRound: (title: string) => void
  vote: (value: CardValue) => void
  unvote: () => void
  reveal: () => void
  leave: () => Promise<void>
  connected: boolean
}

export interface UsePokerSessionOptions {
  sessionId: string
  displayName: string
  /** Optional: override the transport for tests. */
  createTransport?: (sessionId: string) => RoomTransport
  /** Anti-entropy digest broadcast interval; defaults to 5000ms with jitter. Tests can set a small value. */
  digestIntervalMs?: number
  /** Minimum gap between REQUEST_SYNC messages to the same peer. Defaults to 10s. */
  resyncCooldownMs?: number
}

export function usePokerSession({
  sessionId,
  displayName,
  createTransport,
  digestIntervalMs = 5000,
  resyncCooldownMs = 10_000,
}: UsePokerSessionOptions): PokerSessionHandle {
  const [state, dispatch] = useReducer(reducer, sessionId, initialState)
  const [peers, setPeers] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const roomRef = useRef<RoomTransport | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const displayNameRef = useRef(displayName)
  displayNameRef.current = displayName
  const createTransportRef = useRef(createTransport)
  createTransportRef.current = createTransport
  const broadcastRef = useRef<(a: Action) => void>(() => {})

  const selfId = useMemo(() => {
    const existing = sessionStorage.getItem(`poker-self-${sessionId}`)
    if (existing) return existing
    const id = Math.random().toString(36).slice(2, 10)
    sessionStorage.setItem(`poker-self-${sessionId}`, id)
    return id
  }, [sessionId])

  // Per-origin seq counters and last-seen-seq dedupe table.
  // Counters live across React StrictMode remounts by tying them to `sessionId`.
  const seqCounterRef = useRef(0)
  const lastSeenSeqRef = useRef<Map<string, number>>(new Map())
  const envelopeRef = useRef<(action: TransportAction) => ActionEnvelope>(() => {
    throw new Error('envelopeRef used before session mounted')
  })

  useEffect(() => {
    const transport = (createTransportRef.current ?? createRoom)(sessionId)
    roomRef.current = transport
    setConnected(true)

    const wrap = (action: TransportAction): ActionEnvelope => ({
      action,
      originId: selfId,
      seq: ++seqCounterRef.current,
    })
    envelopeRef.current = wrap

    // Seed state from local snapshot for zombie recovery: if the mesh is empty
    // right now but we have a recent snapshot, restore it. Live HELLO_SYNC from
    // any peer that joins later will merge on top via pickNewerRound / mergeParticipants.
    const snapshot = readSnapshot(sessionId)
    if (snapshot) {
      dispatch({ type: 'HELLO_SYNC', state: snapshot })
    }

    const me: Participant = { id: selfId, name: displayNameRef.current, joinedAt: Date.now() }
    dispatch({ type: 'PARTICIPANT_JOIN', participant: me })

    broadcastRef.current = (action: Action) => {
      dispatch(action)
      transport.send(wrap(action))
    }

    // Announce myself to anyone already in the room.
    transport.send(wrap({ type: 'PARTICIPANT_JOIN', participant: me }))

    // Resync rate-limit: per-peer last REQUEST_SYNC timestamp.
    const lastSyncRequestAt = new Map<string, number>()

    const handleControl = (action: ControlAction, fromPeer: string) => {
      if (action.type === 'REQUEST_SYNC') {
        transport.sendTo(fromPeer, wrap({ type: 'HELLO_SYNC', state: stateRef.current }))
        return
      }
      if (action.type === 'STATE_DIGEST') {
        const { digest: localDigest } = computeDigest(stateRef.current)
        if (localDigest === action.digest) return
        const now = Date.now()
        const last = lastSyncRequestAt.get(fromPeer) ?? 0
        if (now - last < resyncCooldownMs) return
        lastSyncRequestAt.set(fromPeer, now)
        transport.sendTo(
          fromPeer,
          wrap({ type: 'REQUEST_SYNC', reason: 'digest-mismatch' }),
        )
      }
    }

    const offAction = transport.onAction((envelope, fromPeer) => {
      const { action, originId, seq } = envelope
      const last = lastSeenSeqRef.current.get(originId)
      if (last !== undefined && seq <= last) return
      lastSeenSeqRef.current.set(originId, seq)
      if (isControlAction(action)) {
        handleControl(action, fromPeer)
        return
      }
      dispatch(action)
    })

    const offJoin = transport.onPeerJoin((peerId) => {
      setPeers((p) => (p.includes(peerId) ? p : [...p, peerId]))
      // Re-announce ourselves and sync full state to the new peer.
      transport.sendTo(peerId, wrap({ type: 'PARTICIPANT_JOIN', participant: me }))
      transport.sendTo(peerId, wrap({ type: 'HELLO_SYNC', state: stateRef.current }))
    })

    const offLeave = transport.onPeerLeave((peerId) => {
      setPeers((p) => p.filter((x) => x !== peerId))
      dispatch({ type: 'PARTICIPANT_LEAVE', participantId: peerId })
    })

    // Periodic anti-entropy: broadcast our digest so peers can detect divergence.
    // Jitter the interval a little to avoid synchronized bursts across peers.
    const digestTimer = setInterval(
      () => {
        const { digest, summary } = computeDigest(stateRef.current)
        transport.send(wrap({ type: 'STATE_DIGEST', digest, summary }))
      },
      digestIntervalMs + Math.floor(Math.random() * Math.max(1, digestIntervalMs / 5)),
    )

    return () => {
      clearInterval(digestTimer)
      offAction()
      offJoin()
      offLeave()
      transport.send(wrap({ type: 'PARTICIPANT_LEAVE', participantId: selfId }))
      transport.leave().catch(() => {})
      roomRef.current = null
      setConnected(false)
    }
  }, [sessionId, selfId, digestIntervalMs, resyncCooldownMs])

  // If our display name changes mid-session, let peers know.
  useEffect(() => {
    const transport = roomRef.current
    if (!transport) return
    const action: Action = { type: 'PARTICIPANT_RENAME', participantId: selfId, name: displayName }
    dispatch(action)
    transport.send(envelopeRef.current(action))
  }, [displayName, selfId])

  // Auto-reveal when everybody has voted.
  useEffect(() => {
    if (shouldAutoReveal(state)) {
      const transport = roomRef.current
      if (!transport) return
      const action: Action = { type: 'REVEAL', by: selfId, at: Date.now() }
      dispatch(action)
      transport.send(envelopeRef.current(action))
    }
  }, [state, selfId])

  // Debounced local snapshot so a brief "everyone offline" moment doesn't wipe context.
  useEffect(() => {
    const handle = setTimeout(() => writeSnapshot(sessionId, state), 500)
    return () => clearTimeout(handle)
  }, [sessionId, state])

  const startRound = (title: string) => {
    const round = createRound({ title, id: generateRoundId() })
    broadcastRef.current({ type: 'ROUND_START', round })
  }
  const vote = (value: CardValue) => {
    broadcastRef.current({ type: 'VOTE', participantId: selfId, value })
  }
  const unvote = () => {
    broadcastRef.current({ type: 'UNVOTE', participantId: selfId })
  }
  const reveal = () => {
    broadcastRef.current({ type: 'REVEAL', by: selfId, at: Date.now() })
  }
  const leave = async () => {
    const transport = roomRef.current
    // Explicit leave wipes the snapshot; tab-close (no leave call) preserves it
    // so a quick reopen restores context.
    clearSnapshot(sessionId)
    if (!transport) return
    transport.send(envelopeRef.current({ type: 'PARTICIPANT_LEAVE', participantId: selfId }))
    // Tiny flush window so the leave message has a chance to reach peers
    // before the data channels tear down. Peers' onPeerLeave is authoritative.
    await new Promise((r) => setTimeout(r, 100))
    await transport.leave()
  }

  return { state, selfId, peers, startRound, vote, unvote, reveal, leave, connected }
}
