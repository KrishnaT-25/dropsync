import type { Server, Socket } from 'socket.io'
import { z } from 'zod'
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

  socket.on('meeting-activity', async (payload) => {
    if (!meetingSession) return
    const parsed = activitySchema.safeParse(payload)
    if (!parsed.success) return

    const meeting = await meetingStore.getMeeting(meetingSession.code)
    if (!meeting) return
    const actor = meeting.participants.find((p) => p.id === meetingSession!.participantId)
    if (!actor) return

    io.to(meetingChannel(meetingSession.code)).emit('meeting-activity', {
      actorId: actor.id,
      actorName: actor.name,
      content: parsed.data.content,
    })
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
