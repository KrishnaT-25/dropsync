import type { Socket } from 'socket.io-client'
import type { ApiMeetingRecord, MeetingParticipant } from '../types'
import { getSocket, connectSocket } from './socket'

export interface JoinMeetingAck {
  ok: boolean
  error?: string
  meeting?: ApiMeetingRecord
}

export function joinMeetingSocket(
  code: string,
  participantId: string,
  displayName: string,
): Promise<JoinMeetingAck> {
  const instance = connectSocket()
  return new Promise((resolve) => {
    instance.emit(
      'join-meeting',
      { code, participantId, displayName },
      (ack: JoinMeetingAck) => {
        resolve(ack ?? { ok: false, error: 'No response from server' })
      },
    )
  })
}

export function emitMeetingMediaState(payload: {
  isMuted?: boolean
  isCameraOff?: boolean
  isScreenSharing?: boolean
}) {
  getSocket().emit('meeting-media-state', payload)
}

export function emitMeetingActivity(content: string) {
  getSocket().emit('meeting-activity', { content })
}

export function emitHostMute(targetParticipantId: string) {
  getSocket().emit('host-mute', { targetParticipantId })
}

export function emitHostRemove(targetParticipantId: string) {
  getSocket().emit('host-remove', { targetParticipantId })
}

export function emitHostEnd() {
  getSocket().emit('host-end')
}

export function emitLeaveMeeting() {
  getSocket().emit('leave-meeting')
}

export function onMeetingState(handler: (meeting: ApiMeetingRecord) => void) {
  getSocket().on('meeting-state', handler)
}

export function offMeetingState(handler: (meeting: ApiMeetingRecord) => void) {
  getSocket().off('meeting-state', handler)
}

export function onPeerJoined(
  handler: (payload: { participant: MeetingParticipant | null; meeting: ApiMeetingRecord }) => void,
) {
  getSocket().on('peer-joined', handler)
}

export function offPeerJoined(
  handler: (payload: { participant: MeetingParticipant | null; meeting: ApiMeetingRecord }) => void,
) {
  getSocket().off('peer-joined', handler)
}

export function onPeerLeft(
  handler: (payload: { participantId: string; meeting: ApiMeetingRecord }) => void,
) {
  getSocket().on('peer-left', handler)
}

export function offPeerLeft(
  handler: (payload: { participantId: string; meeting: ApiMeetingRecord }) => void,
) {
  getSocket().off('peer-left', handler)
}

export function onMeetingActivity(
  handler: (payload: { actorId: string; actorName: string; content: string }) => void,
) {
  getSocket().on('meeting-activity', handler)
}

export function offMeetingActivity(
  handler: (payload: { actorId: string; actorName: string; content: string }) => void,
) {
  getSocket().off('meeting-activity', handler)
}

export function onForceMuted(handler: (payload: { targetParticipantId: string }) => void) {
  getSocket().on('force-muted', handler)
}

export function offForceMuted(handler: (payload: { targetParticipantId: string }) => void) {
  getSocket().off('force-muted', handler)
}

export function onRemovedByHost(handler: () => void) {
  getSocket().on('removed-by-host', handler)
}

export function offRemovedByHost(handler: () => void) {
  getSocket().off('removed-by-host', handler)
}

export function onMeetingEnded(handler: (payload: { reason: 'host_ended' | 'host_left' }) => void) {
  getSocket().on('meeting-ended', handler)
}

export function offMeetingEnded(handler: (payload: { reason: 'host_ended' | 'host_left' }) => void) {
  getSocket().off('meeting-ended', handler)
}

export function getMeetingSocket(): Socket {
  return getSocket()
}
