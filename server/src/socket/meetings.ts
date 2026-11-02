import type { Server, Socket } from 'socket.io'
import { z } from 'zod'
import {
  RATE_LIMITS,
  checkRateLimit,
  clientIpFromSocket,
} from '../services/rateLimit.js'
import { meetingStore, toPublicMeeting, waitingParticipants } from '../store/meetingStore.js'
import type { MeetingEndedReason, MeetingRecord } from '../types.js'
import { isValidRoomCode, normalizeRoomCode } from '../utils/roomCode.js'
import { trackSocketCleanup } from './cleanupTasks.js'

const joinMeetingSchema = z.object({
  code: z.string(),
  participantId: z.string().uuid(),
  accessToken: z.string().min(40),
  displayName: z.string().trim().min(1).max(32),
})

const mediaStateSchema = z.object({
  isMuted: z.boolean().optional(),
  isCameraOff: z.boolean().optional(),
  isScreenSharing: z.boolean().optional(),
})

const targetSchema = z.object({
  targetParticipantId: z.string().uuid(),
})
const permissionsSchema = z.object({
  requireAdmission: z.boolean().optional(),
  allowScreenShare: z.boolean().optional(),
  allowParticipantUnmute: z.boolean().optional(),
}).strict()
const coHostSchema = targetSchema.extend({ enabled: z.boolean() })

const activitySchema = z.object({
  content: z.string().trim().min(1).max(200),
})

const mediaSignalSchema = z.object({
  targetParticipantId: z.string().uuid(),
  senderParticipantId: z.string().uuid(),
  payload: z.unknown(),
})

export interface MeetingSocketSession {
  code: string
  participantId: string
  admitted: boolean
}

function notifyWaitingRoom(io: Server, meeting: MeetingRecord): void {
  const waiting = waitingParticipants(meeting)
  for (const person of meeting.participants) {
    if (person.admitted && (person.isHost || person.isCoHost) && person.socketId) {
      io.to(person.socketId).emit('meeting-waiting', waiting)
    }
  }
}

function meetingChannel(code: string) {
  return `meeting:${code}`
}

async function endMeetingForAll(
  io: Server,
  code: string,
  reason: MeetingEndedReason,
): Promise<void> {
  const channel = meetingChannel(code)
  io.to(channel).emit('meeting-ended', { reason })
  const meeting = await meetingStore.getMeeting(code)
  for (const person of meeting?.participants ?? []) {
    if (!person.admitted && person.socketId) io.to(person.socketId).emit('meeting-ended', { reason })
  }
  const sockets = await io.in(channel).fetchSockets()
  for (const s of sockets) {
    await s.leave(channel)
  }
  await meetingStore.deleteMeeting(code)
}

export function registerMeetingSocketHandlers(io: Server, socket: Socket) {
  let meetingSession: MeetingSocketSession | null = null

  const clearSession = () => {
    meetingSession = null
  }

  socket.on('join-meeting', async (payload, ack) => {
    const ip = clientIpFromSocket(socket.handshake)
    const joinLimit = await checkRateLimit(
      `join-meeting:${ip}`,
      RATE_LIMITS.joinIp.max,
      RATE_LIMITS.joinIp.windowMs,
    )
    if (!joinLimit.allowed) {
      ack?.({ ok: false, error: 'Slow down a bit', code: 'rate_limited' })
      return
    }

    const parsed = joinMeetingSchema.safeParse(payload)
    if (!parsed.success) {
      ack?.({ ok: false, error: 'Invalid join payload' })
      return
    }

    const code = normalizeRoomCode(parsed.data.code)
    if (!isValidRoomCode(code)) {
      ack?.({ ok: false, error: 'Invalid meeting code' })
      return
    }
    if (meetingSession && (meetingSession.code !== code || meetingSession.participantId !== parsed.data.participantId)) {
      ack?.({ ok: false, error: 'Leave the current meeting before joining another' })
      return
    }

    const existing = await meetingStore.getMeeting(code)
    if (!existing) {
      ack?.({ ok: false, error: 'Meeting not found or participant invalid' })
      return
    }
    const alreadyIn = existing.participants.some((p) => p.id === parsed.data.participantId)
    if (!alreadyIn && existing.participants.length >= 6) {
      ack?.({ ok: false, error: 'This meeting supports at most 6 participants.' })
      return
    }

    const bound = await meetingStore.bindSocket(
      code, parsed.data.participantId, parsed.data.accessToken, socket.id, parsed.data.displayName,
    )
    if (!bound) {
      ack?.({ ok: false, error: 'Meeting access denied' })
      return
    }

    const { meeting } = bound
    meetingSession = { code, participantId: parsed.data.participantId, admitted: bound.admitted }
    if (!bound.admitted) {
      ack?.({ ok: true, waiting: true })
      notifyWaitingRoom(io, meeting)
      return
    }

    const channel = meetingChannel(code)
    await socket.join(channel)

    const publicMeeting = toPublicMeeting(meeting)
    const self = meeting.participants.find((p) => p.id === parsed.data.participantId)

    ack?.({ ok: true, meeting: publicMeeting,
      waitingRoom: self?.isHost || self?.isCoHost ? waitingParticipants(meeting) : undefined })
    socket.to(channel).emit('peer-joined', {
      participant: self
        ? {
            id: self.id,
            name: self.name,
            isHost: self.isHost,
            isMuted: self.isMuted,
            isCameraOff: self.isCameraOff,
            isScreenSharing: self.isScreenSharing,
          }
        : null,
      meeting: publicMeeting,
    })
    io.to(channel).emit('meeting-state', publicMeeting)
  })

  socket.on('meeting-media-state', async (payload) => {
    if (!meetingSession?.admitted) return
    const parsed = mediaStateSchema.safeParse(payload)
    if (!parsed.success) return

    const meeting = await meetingStore.updateParticipantMedia(
      meetingSession.code,
      meetingSession.participantId,
      parsed.data,
    )
    if (meeting) {
      io.to(meetingChannel(meetingSession.code)).emit('meeting-state', toPublicMeeting(meeting))
    }
  })

  socket.on('meeting-activity', async (payload, ack) => {
    if (!meetingSession?.admitted) {
      ack?.({ ok: false, error: 'Not in a meeting' })
      return
    }

    const activityLimit = await checkRateLimit(
      `meeting-activity:${socket.id}`,
      RATE_LIMITS.activity.max,
      RATE_LIMITS.activity.windowMs,
    )
    if (!activityLimit.allowed) {
      ack?.({ ok: false, error: 'Slow down a bit', code: 'rate_limited' })
      return
    }

    const parsed = activitySchema.safeParse(payload)
    if (!parsed.success) {
      ack?.({ ok: false, error: 'Invalid activity' })
      return
    }

    const meeting = await meetingStore.getMeeting(meetingSession.code)
    if (!meeting) {
      ack?.({ ok: false, error: 'Meeting not found' })
      return
    }
    const actor = meeting.participants.find((p) => p.id === meetingSession!.participantId)
    if (!actor) {
      ack?.({ ok: false, error: 'Participant not found' })
      return
    }

    io.to(meetingChannel(meetingSession.code)).emit('meeting-activity', {
      actorId: actor.id,
      actorName: actor.name,
      content: parsed.data.content,
    })
    ack?.({ ok: true })
  })

  const relayMediaSignal = async (
    event: 'meeting-offer' | 'meeting-answer' | 'meeting-ice-candidate',
    payload: unknown,
  ) => {
    if (!meetingSession?.admitted) return
    const parsed = mediaSignalSchema.safeParse(payload)
    if (!parsed.success) return
    if (parsed.data.senderParticipantId !== meetingSession.participantId) return

    const meeting = await meetingStore.getMeeting(meetingSession.code)
    if (!meeting) return
    if (!meeting.participants.some((person) => person.id === meetingSession!.participantId && person.admitted)) return
    const target = meeting.participants.find((p) => p.id === parsed.data.targetParticipantId)
    if (!target?.admitted) return
    if (!target.socketId) {
      // Fallback: broadcast on meeting channel; clients filter by targetParticipantId
      socket.to(meetingChannel(meetingSession.code)).emit(event, parsed.data)
      return
    }
    io.to(target.socketId).emit(event, parsed.data)
  }

  socket.on('meeting-offer', (payload) => {
    void relayMediaSignal('meeting-offer', payload)
  })
  socket.on('meeting-answer', (payload) => {
    void relayMediaSignal('meeting-answer', payload)
  })
  socket.on('meeting-ice-candidate', (payload) => {
    void relayMediaSignal('meeting-ice-candidate', payload)
  })

  socket.on('host-mute', async (payload) => {
    if (!meetingSession?.admitted) return
    const parsed = targetSchema.safeParse(payload)
    if (!parsed.success) return

    const meeting = await meetingStore.forceMute(
      meetingSession.code,
      meetingSession.participantId,
      parsed.data.targetParticipantId,
    )
    if (!meeting) return

    const channel = meetingChannel(meetingSession.code)
    io.to(channel).emit('meeting-state', toPublicMeeting(meeting))
    io.to(channel).emit('force-muted', {
      targetParticipantId: parsed.data.targetParticipantId,
    })
  })

  socket.on('host-remove', async (payload) => {
    if (!meetingSession?.admitted) return
    const parsed = targetSchema.safeParse(payload)
    if (!parsed.success) return

    const result = await meetingStore.hostRemove(
      meetingSession.code,
      meetingSession.participantId,
      parsed.data.targetParticipantId,
    )
    if (!result) return

    const channel = meetingChannel(meetingSession.code)
    const targetSocketId = result.removed?.socketId
    if (targetSocketId) {
      io.to(targetSocketId).emit('removed-by-host', { pending: !result.removed?.admitted })
      const targetSocket = io.sockets.sockets.get(targetSocketId)
      if (targetSocket) await targetSocket.leave(channel)
    }

    if (result.meeting) {
      notifyWaitingRoom(io, result.meeting)
      if (!result.removed?.admitted) return
      io.to(channel).emit('peer-left', {
        participantId: parsed.data.targetParticipantId,
        meeting: toPublicMeeting(result.meeting),
      })
      io.to(channel).emit('meeting-state', toPublicMeeting(result.meeting))
    }
  })

  socket.on('meeting-admit', async (payload, ack) => {
    if (!meetingSession?.admitted) { ack?.({ ok: false }); return }
    const parsed = targetSchema.safeParse(payload)
    if (!parsed.success) { ack?.({ ok: false }); return }
    const result = await meetingStore.admitParticipant(
      meetingSession.code, meetingSession.participantId, parsed.data.targetParticipantId,
    )
    if (!result) { ack?.({ ok: false }); return }
    if (result.admitted.socketId) io.to(result.admitted.socketId).emit('meeting-admitted')
    notifyWaitingRoom(io, result.meeting)
    ack?.({ ok: true })
  })

  socket.on('meeting-permissions', async (payload, ack) => {
    if (!meetingSession?.admitted) { ack?.({ ok: false }); return }
    const parsed = permissionsSchema.safeParse(payload)
    if (!parsed.success) { ack?.({ ok: false }); return }
    const meeting = await meetingStore.setPermissions(meetingSession.code, meetingSession.participantId, parsed.data)
    if (!meeting) { ack?.({ ok: false }); return }
    io.to(meetingChannel(meetingSession.code)).emit('meeting-state', toPublicMeeting(meeting))
    ack?.({ ok: true })
  })

  socket.on('meeting-cohost', async (payload, ack) => {
    if (!meetingSession?.admitted) { ack?.({ ok: false }); return }
    const parsed = coHostSchema.safeParse(payload)
    if (!parsed.success) { ack?.({ ok: false }); return }
    const meeting = await meetingStore.setCoHost(
      meetingSession.code, meetingSession.participantId, parsed.data.targetParticipantId, parsed.data.enabled,
    )
    if (!meeting) { ack?.({ ok: false }); return }
    io.to(meetingChannel(meetingSession.code)).emit('meeting-state', toPublicMeeting(meeting))
    notifyWaitingRoom(io, meeting)
    ack?.({ ok: true })
  })

  socket.on('host-end', async () => {
    if (!meetingSession?.admitted) return
    const meeting = await meetingStore.getMeeting(meetingSession.code)
    if (!meeting) return
    if (meeting.hostParticipantId !== meetingSession.participantId) return

    const code = meetingSession.code
    clearSession()
    await endMeetingForAll(io, code, 'host_ended')
  })

  socket.on('leave-meeting', async () => {
    if (!meetingSession) return
    const { code, participantId } = meetingSession
    const meeting = await meetingStore.getMeeting(code)
    clearSession()
    await socket.leave(meetingChannel(code))

    if (!meeting) return

    if (meeting.hostParticipantId === participantId) {
      await endMeetingForAll(io, code, 'host_left')
      return
    }

    const { meeting: next, removed } = await meetingStore.removeParticipant(code, participantId)
    if (next) {
      notifyWaitingRoom(io, next)
      if (!removed?.admitted) return
      io.to(meetingChannel(code)).emit('peer-left', {
        participantId,
        meeting: toPublicMeeting(next),
      })
      io.to(meetingChannel(code)).emit('meeting-state', toPublicMeeting(next))
    }
  })

  const handleDisconnect = async () => {
    if (!meetingSession) return
    const { code, participantId } = meetingSession
    const meeting = await meetingStore.getMeeting(code)
    clearSession()

    if (!meeting) return

    if (meeting.hostParticipantId === participantId) {
      await endMeetingForAll(io, code, 'host_left')
      return
    }

    const { meeting: next, removed } = await meetingStore.removeParticipant(code, participantId)
    if (next) {
      notifyWaitingRoom(io, next)
      if (!removed?.admitted) return
      io.to(meetingChannel(code)).emit('peer-left', {
        participantId,
        meeting: toPublicMeeting(next),
      })
      io.to(meetingChannel(code)).emit('meeting-state', toPublicMeeting(next))
    }
  }

  socket.on('disconnect', () => {
    trackSocketCleanup(handleDisconnect())
  })

  return {
    hasMeetingSession: () => Boolean(meetingSession),
    clearMeetingSession: clearSession,
  }
}
