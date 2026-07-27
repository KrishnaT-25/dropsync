import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { z } from 'zod'
import { config } from '../config.js'
import { roomStore } from '../store/roomStore.js'
import type { ActivityItem } from '../types.js'
import { isValidRoomCode, normalizeRoomCode } from '../utils/roomCode.js'

const joinSchema = z.object({
  code: z.string(),
  participantId: z.string().uuid(),
})

const activitySchema = z.object({
  type: z.enum(['message', 'file', 'link', 'clipboard', 'code', 'meeting']),
  content: z.string().min(1).max(10000),
  fileMeta: z
    .object({
      fileName: z.string(),
      fileSize: z.number(),
      mimeType: z.string(),
    })
    .optional(),
})

const meetingStateSchema = z.object({
  inMeeting: z.boolean().optional(),
  isMuted: z.boolean().optional(),
  isCameraOff: z.boolean().optional(),
  isScreenSharing: z.boolean().optional(),
})

interface SocketSession {
  code: string
  participantId: string
}

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.clientOrigin,
      methods: ['GET', 'POST'],
    },
  })

  roomStore.setOnExpire((code) => {
    io.to(code).emit('room-expired')
    io.in(code).socketsLeave(code)
  })

  io.on('connection', (socket) => {
    let session: SocketSession | null = null

    socket.on('join-room', (payload, ack) => {
      const parsed = joinSchema.safeParse(payload)
      if (!parsed.success) {
        ack?.({ ok: false, error: 'Invalid join payload' })
        return
      }

      const code = normalizeRoomCode(parsed.data.code)
      if (!isValidRoomCode(code)) {
        ack?.({ ok: false, error: 'Invalid room code' })
        return
      }

      const room = roomStore.bindSocket(code, parsed.data.participantId, socket.id)
      if (!room) {
        ack?.({ ok: false, error: 'Room not found or participant invalid' })
        return
      }

      session = { code, participantId: parsed.data.participantId }
      socket.join(code)

      const participant = room.participants.find((p) => p.id === parsed.data.participantId)
      if (participant && !room.activities.some((a) => a.content.includes('connected'))) {
        // no-op for first connect
      }

      ack?.({ ok: true, room })
      socket.to(code).emit('room-state', room)
    })

    socket.on('activity', (payload) => {
      if (!session) return

      const parsed = activitySchema.safeParse(payload)
      if (!parsed.success) return

      const room = roomStore.getRoom(session.code)
      if (!room) return

      const participant = room.participants.find((p) => p.id === session!.participantId)
      const activity = roomStore.addActivity(session.code, {
        type: parsed.data.type,
        content: parsed.data.content,
        sender: participant?.name ?? 'Guest',
        senderId: session.participantId,
        fileMeta: parsed.data.fileMeta,
      })

      if (activity) {
        io.to(session.code).emit('activity', activity)
      }
    })

    socket.on('meeting-state', (payload) => {
      if (!session) return

      const parsed = meetingStateSchema.safeParse(payload)
      if (!parsed.success) return

      const room = roomStore.updateMeetingState(session.code, session.participantId, parsed.data)
      if (room) {
        io.to(session.code).emit('room-state', room)
      }
    })

    socket.on('system-activity', (content: string) => {
      if (!session || typeof content !== 'string' || !content.trim()) return

      const room = roomStore.getRoom(session.code)
      if (!room) return

      const participant = room.participants.find((p) => p.id === session!.participantId)
      const activity = roomStore.addActivity(session.code, {
        type: 'meeting',
        content: content.trim(),
        sender: participant?.name ?? 'Guest',
        senderId: session.participantId,
      })

      if (activity) {
        io.to(session.code).emit('activity', activity as ActivityItem)
      }
    })

    socket.on('leave-room', () => {
      if (!session) return

      const { code, participantId } = session
      roomStore.unbindSocket(code, participantId)
      socket.leave(code)
      const room = roomStore.getRoom(code)
      if (room) {
        io.to(code).emit('room-state', room)
      }
      session = null
    })

    socket.on('disconnect', () => {
      if (!session) return

      const { code, participantId } = session
      const room = roomStore.removeParticipant(code, participantId)
      if (room) {
        io.to(code).emit('room-state', room)
      } else {
        io.to(code).emit('room-expired')
      }
      session = null
    })
  })

  return io
}
