import { joinRoom, selfId as trysteroSelfId, type JsonValue } from 'trystero'
import type { ActionEnvelope, SessionState } from './types'

const APP_ID = 'poker-planning-witalewski'

export interface RoomTransport {
  sessionId: string
  selfId: string
  send: (envelope: ActionEnvelope) => void
  sendTo: (peerId: string, envelope: ActionEnvelope) => void
  onAction: (handler: (envelope: ActionEnvelope, fromPeer: string) => void) => () => void
  onPeerJoin: (handler: (peerId: string) => void) => () => void
  onPeerLeave: (handler: (peerId: string) => void) => () => void
  leave: () => Promise<void>
}

export function createRoom(sessionId: string): RoomTransport {
  const room = joinRoom({ appId: APP_ID }, sessionId)
  const [sendAction, onAction] = room.makeAction<ActionEnvelope & JsonValue>('action')

  const actionHandlers = new Set<(envelope: ActionEnvelope, fromPeer: string) => void>()
  const joinHandlers = new Set<(peerId: string) => void>()
  const leaveHandlers = new Set<(peerId: string) => void>()

  onAction((data, peerId) => {
    actionHandlers.forEach((h) => h(data as ActionEnvelope, peerId))
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
    send: (envelope) => {
      sendAction(envelope as ActionEnvelope & JsonValue)
    },
    sendTo: (peerId, envelope) => {
      sendAction(envelope as ActionEnvelope & JsonValue, peerId)
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
