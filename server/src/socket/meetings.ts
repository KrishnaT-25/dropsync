import type { Server, Socket } from 'socket.io'
import { z } from 'zod'
import {
  RATE_LIMITS,
  checkRateLimit,
  clientIpFromSocket,
} from '../services/rateLimit.js'
import { meetingStore, toPublicMeeting } from '../store/meetingStore.js'
import type { MeetingEndedReason } from '../types.js'
import { isValidRoomCode, normalizeRoomCode } from '../utils/roomCode.js'

const joinMeetingSchema = z.object({
  code: z.string(),
  participantId: z.string().uuid(),
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

    const named = await meetingStore.setParticipantName(
      code,
      parsed.data.participantId,
      parsed.data.displayName,
    )
    if (!named) {
      ack?.({ ok: false, error: 'Meeting not found or participant invalid' })
      return
    }

    const meeting = await meetingStore.bindSocket(code, parsed.data.participantId, socket.id)
    if (!meeting) {
      ack?.({ ok: false, error: 'Meeting not found or participant invalid' })
      return
    }

    meetingSession = { code, participantId: parsed.data.participantId }
    const channel = meetingChannel(code)
    await socket.join(channel)

    const publicMeeting = toPublicMeeting(meeting)
    const self = meeting.participants.find((p) => p.id === parsed.data.participantId)

    ack?.({ ok: true, meeting: publicMeeting })
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
    if (!meetingSession) return
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
    if (!meetingSession) {
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
    if (!meetingSession) return
    const parsed = mediaSignalSchema.safeParse(payload)
    if (!parsed.success) return
    if (parsed.data.senderParticipantId !== meetingSession.participantId) return

    const meeting = await meetingStore.getMeeting(meetingSession.code)
    if (!meeting) return
    const target = meeting.participants.find((p) => p.id === parsed.data.targetParticipantId)
    if (!target?.socketId) {
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
    if (!meetingSession) return
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
    if (!meetingSession) return
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
      io.to(targetSocketId).emit('removed-by-host')
      const targetSocket = io.sockets.sockets.get(targetSocketId)
      if (targetSocket) await targetSocket.leave(channel)
    }

    if (result.meeting) {
      io.to(channel).emit('peer-left', {
        participantId: parsed.data.targetParticipantId,
        meeting: toPublicMeeting(result.meeting),
      })
      io.to(channel).emit('meeting-state', toPublicMeeting(result.meeting))
    }
  })

  socket.on('host-end', async () => {
    if (!meetingSession) return
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

    const { meeting: next } = await meetingStore.removeParticipant(code, participantId)
    if (next) {
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

    const { meeting: next } = await meetingStore.removeParticipant(code, participantId)
    if (next) {
      io.to(meetingChannel(code)).emit('peer-left', {
        participantId,
        meeting: toPublicMeeting(next),
      })
      io.to(meetingChannel(code)).emit('meeting-state', toPublicMeeting(next))
    }
  }

  socket.on('disconnect', () => {
    void handleDisconnect()
  })

  return {
    hasMeetingSession: () => Boolean(meetingSession),
    clearMeetingSession: clearSession,
  }
}
