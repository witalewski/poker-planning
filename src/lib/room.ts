import { joinRoom, selfId as trysteroSelfId, type JsonValue } from 'trystero'
import type { Action, SessionState } from './types'

const APP_ID = 'poker-planning-witalewski'

export interface RoomTransport {
  sessionId: string
  selfId: string
  send: (action: Action) => void
  sendTo: (peerId: string, action: Action) => void
  onAction: (handler: (action: Action, fromPeer: string) => void) => () => void
  onPeerJoin: (handler: (peerId: string) => void) => () => void
  onPeerLeave: (handler: (peerId: string) => void) => () => void
  leave: () => Promise<void>
}

export function createRoom(sessionId: string): RoomTransport {
  const room = joinRoom({ appId: APP_ID }, sessionId)
  const [sendAction, onAction] = room.makeAction<Action & JsonValue>('action')

  const actionHandlers = new Set<(action: Action, fromPeer: string) => void>()
  const joinHandlers = new Set<(peerId: string) => void>()
  const leaveHandlers = new Set<(peerId: string) => void>()

  onAction((data, peerId) => {
    actionHandlers.forEach((h) => h(data as Action, peerId))
  })
  room.onPeerJoin((peerId) => {
    joinHandlers.forEach((h) => h(peerId))
  })
  room.onPeerLeave((peerId) => {
    leaveHandlers.forEach((h) => h(peerId))
  })

  return {
    sessionId,
    selfId: trysteroSelfId,
    send: (action) => {
      sendAction(action as Action & JsonValue)
    },
    sendTo: (peerId, action) => {
      sendAction(action as Action & JsonValue, peerId)
    },
    onAction: (h) => {
      actionHandlers.add(h)
      return () => {
        actionHandlers.delete(h)
      }
    },
    onPeerJoin: (h) => {
      joinHandlers.add(h)
      return () => {
        joinHandlers.delete(h)
      }
    },
    onPeerLeave: (h) => {
      leaveHandlers.add(h)
      return () => {
        leaveHandlers.delete(h)
      }
    },
    leave: async () => {
      await room.leave()
    },
  }
}

export type { SessionState }
