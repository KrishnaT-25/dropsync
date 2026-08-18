import { io, type Socket } from 'socket.io-client'
import type { ActivityItem, ApiRoomRecord } from '../types'

const SOCKET_URL = import.meta.env.VITE_API_URL ?? window.location.origin

export interface JoinRoomAck {
  ok: boolean
  error?: string
  room?: ApiRoomRecord
}

export interface ActivityPayload {
  type: ActivityItem['type']
  content: string
  fileMeta?: {
    fileName: string
    fileSize: number
    mimeType: string
    transferId?: string
    progress?: number
    status?: 'pending' | 'transferring' | 'complete' | 'failed'
    transferPath?: 'direct' | 'relay' | 'storage'
    downloadUrl?: string
  }
}

export interface MeetingStatePayload {
  inMeeting?: boolean
  isMuted?: boolean
  isCameraOff?: boolean
  isScreenSharing?: boolean
}

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
    })
  }
  return socket
}

export function connectSocket(): Socket {
  const instance = getSocket()
  if (!instance.connected) {
    instance.connect()
  }
  return instance
}

export function disconnectSocket() {
  if (socket?.connected) {
    socket.disconnect()
  }
}

export function joinRoomSocket(
  code: string,
  participantId: string,
): Promise<JoinRoomAck> {
  const instance = connectSocket()
  return new Promise((resolve) => {
    instance.emit('join-room', { code, participantId }, (ack: JoinRoomAck) => {
      resolve(ack ?? { ok: false, error: 'No response from server' })
    })
  })
}

export function emitActivity(payload: ActivityPayload) {
  getSocket().emit('activity', payload)
}

export function emitMeetingState(payload: MeetingStatePayload) {
  getSocket().emit('meeting-state', payload)
}

export function emitSystemActivity(content: string) {
  getSocket().emit('system-activity', content)
}

export function emitLeaveRoom() {
  getSocket().emit('leave-room')
}

export function onRoomState(handler: (room: ApiRoomRecord) => void) {
  getSocket().on('room-state', handler)
}

export function onActivity(handler: (activity: ActivityItem & { timestamp: string }) => void) {
  getSocket().on('activity', handler)
}

export function onRoomExpired(handler: () => void) {
  getSocket().on('room-expired', handler)
}

export function offRoomState(handler: (room: ApiRoomRecord) => void) {
  getSocket().off('room-state', handler)
}

export function offActivity(handler: (activity: ActivityItem & { timestamp: string }) => void) {
  getSocket().off('activity', handler)
}

export function offRoomExpired(handler: () => void) {
  getSocket().off('room-expired', handler)
}

export function onSocketConnect(handler: () => void) {
  getSocket().on('connect', handler)
}

export function onSocketDisconnect(handler: () => void) {
  getSocket().on('disconnect', handler)
}

export function offSocketConnect(handler: () => void) {
  getSocket().off('connect', handler)
}

export function offSocketDisconnect(handler: () => void) {
  getSocket().off('disconnect', handler)
}

export function onFileTransferComplete(
  handler: (payload: {
    activityId: string
    transferId: string
    downloadUrl: string
    transferPath: 'direct' | 'relay' | 'storage'
    senderParticipantId: string
  }) => void,
) {
  getSocket().on('file-transfer-complete', handler)
}

export function offFileTransferComplete(
  handler: (payload: {
    activityId: string
    transferId: string
    downloadUrl: string
    transferPath: 'direct' | 'relay' | 'storage'
    senderParticipantId: string
  }) => void,
) {
  getSocket().off('file-transfer-complete', handler)
}

export function isSocketConnected(): boolean {
  return getSocket().connected
}
