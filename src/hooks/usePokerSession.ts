import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createRoom, type RoomTransport } from '../lib/room'
import { generateRoundId } from '../lib/codes'
import { initialState, reducer, createRound, shouldAutoReveal } from '../lib/state'
import type { Action, CardValue, Participant, SessionState } from '../lib/types'

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
}

export function usePokerSession({
  sessionId,
  displayName,
  createTransport,
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

  useEffect(() => {
    const transport = (createTransportRef.current ?? createRoom)(sessionId)
    roomRef.current = transport
    setConnected(true)

    const me: Participant = { id: selfId, name: displayNameRef.current, joinedAt: Date.now() }
    dispatch({ type: 'PARTICIPANT_JOIN', participant: me })

    broadcastRef.current = (action: Action) => {
      dispatch(action)
      transport.send(action)
    }

    // Announce myself to anyone already in the room.
    transport.send({ type: 'PARTICIPANT_JOIN', participant: me })

    const offAction = transport.onAction((action) => {
      dispatch(action)
    })

    const offJoin = transport.onPeerJoin((peerId) => {
      setPeers((p) => (p.includes(peerId) ? p : [...p, peerId]))
      // Re-announce ourselves and sync full state to the new peer.
      transport.sendTo(peerId, { type: 'PARTICIPANT_JOIN', participant: me })
      transport.sendTo(peerId, { type: 'HELLO_SYNC', state: stateRef.current })
    })

    const offLeave = transport.onPeerLeave((peerId) => {
      setPeers((p) => p.filter((x) => x !== peerId))
      dispatch({ type: 'PARTICIPANT_LEAVE', participantId: peerId })
    })

    return () => {
      offAction()
      offJoin()
      offLeave()
      transport.send({ type: 'PARTICIPANT_LEAVE', participantId: selfId })
      transport.leave().catch(() => {})
      roomRef.current = null
      setConnected(false)
    }
  }, [sessionId, selfId])

  // If our display name changes mid-session, let peers know.
  useEffect(() => {
    const transport = roomRef.current
    if (!transport) return
    const me: Participant = { id: selfId, name: displayName, joinedAt: Date.now() }
    dispatch({ type: 'PARTICIPANT_JOIN', participant: me })
    transport.send({ type: 'PARTICIPANT_JOIN', participant: me })
  }, [displayName, selfId])

  // Auto-reveal when everybody has voted.
  useEffect(() => {
    if (shouldAutoReveal(state)) {
      const transport = roomRef.current
      if (!transport) return
      const action: Action = { type: 'REVEAL', by: selfId, at: Date.now() }
      dispatch(action)
      transport.send(action)
    }
  }, [state, selfId])

  const startRound = (title: string) => {
    const round = createRound({ title, startedBy: selfId, id: generateRoundId() })
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
    if (!transport) return
    transport.send({ type: 'PARTICIPANT_LEAVE', participantId: selfId })
    await transport.leave()
  }

  return { state, selfId, peers, startRound, vote, unvote, reveal, leave, connected }
}
