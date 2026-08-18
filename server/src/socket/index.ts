import type { Server as HttpServer } from 'node:http'
import type { Redis } from 'ioredis'
import { createAdapter } from '@socket.io/redis-adapter'
import { Server } from 'socket.io'
import { z } from 'zod'
import { config } from '../config.js'
import { roomStore } from '../store/roomStore.js'
import type { ActivityItem } from '../types.js'
import { toPublicRoom } from '../utils/publicRoom.js'
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
      transferId: z.string().uuid().optional(),
      progress: z.number().min(0).max(1).optional(),
      status: z.enum(['pending', 'transferring', 'complete', 'failed']).optional(),
      transferPath: z.enum(['direct', 'relay', 'storage']).optional(),
      downloadUrl: z.string().url().optional(),
    })
    .optional(),
})

const meetingStateSchema = z.object({
  inMeeting: z.boolean().optional(),
  isMuted: z.boolean().optional(),
  isCameraOff: z.boolean().optional(),
  isScreenSharing: z.boolean().optional(),
})

const fileSignalSchema = z.object({
  targetParticipantId: z.string().uuid(),
  senderParticipantId: z.string().uuid(),
  payload: z.unknown(),
})

interface SocketSession {
  code: string
  participantId: string
}

export function createSocketServer(
  httpServer: HttpServer,
  redisClients?: { redisPub: Redis; redisSub: Redis },
) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.clientOrigin,
      methods: ['GET', 'POST'],
    },
  })

  if (redisClients) {
    io.adapter(createAdapter(redisClients.redisPub, redisClients.redisSub))
  }

  roomStore.setOnExpire((code) => {
    io.to(code).emit('room-expired')
    void io.in(code).socketsLeave(code)
  })

  roomStore.startExpiryPoller()

  io.on('connection', (socket) => {
    let session: SocketSession | null = null

    socket.on('join-room', async (payload, ack) => {
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

      const room = await roomStore.bindSocket(code, parsed.data.participantId, socket.id)
      if (!room) {
        ack?.({ ok: false, error: 'Room not found or participant invalid' })
        return
      }

      session = { code, participantId: parsed.data.participantId }
      await socket.join(code)

      ack?.({ ok: true, room: toPublicRoom(room) })
      socket.to(code).emit('room-state', toPublicRoom(room))
    })

    socket.on('activity', async (payload) => {
      if (!session) return

      const parsed = activitySchema.safeParse(payload)
      if (!parsed.success) return

      const room = await roomStore.getRoom(session.code)
      if (!room) return

      const participant = room.participants.find((p) => p.id === session!.participantId)
      const activity = await roomStore.addActivity(session.code, {
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

    socket.on('meeting-state', async (payload) => {
      if (!session) return

      const parsed = meetingStateSchema.safeParse(payload)
      if (!parsed.success) return

      const room = await roomStore.updateMeetingState(session.code, session.participantId, parsed.data)
      if (room) {
        io.to(session.code).emit('room-state', toPublicRoom(room))
      }
    })

    socket.on('system-activity', async (content: string) => {
      if (!session || typeof content !== 'string' || !content.trim()) return

      const room = await roomStore.getRoom(session.code)
      if (!room) return

      const participant = room.participants.find((p) => p.id === session!.participantId)
      const activity = await roomStore.addActivity(session.code, {
        type: 'meeting',
        content: content.trim(),
        sender: participant?.name ?? 'Guest',
        senderId: session.participantId,
      })

      if (activity) {
        io.to(session.code).emit('activity', activity as ActivityItem)
      }
    })

    const relayFileSignal = async (
      event: 'file-offer' | 'file-answer' | 'file-ice-candidate',
      payload: unknown,
    ) => {
      if (!session) return
      const parsed = fileSignalSchema.safeParse(payload)
      if (!parsed.success) return
      if (parsed.data.senderParticipantId !== session.participantId) return

      const room = await roomStore.getRoom(session.code)
      if (!room) return

      const target = room.participants.find((p) => p.id === parsed.data.targetParticipantId)
      if (!target?.socketId) return

      io.to(target.socketId).emit(event, parsed.data)
    }

    socket.on('file-offer', (payload) => {
      void relayFileSignal('file-offer', payload)
    })
    socket.on('file-answer', (payload) => {
      void relayFileSignal('file-answer', payload)
    })
    socket.on('file-ice-candidate', (payload) => {
      void relayFileSignal('file-ice-candidate', payload)
    })

    socket.on('file-transfer-complete', async (payload) => {
      if (!session) return
      const schema = z.object({
        activityId: z.string(),
        transferId: z.string().uuid(),
        downloadUrl: z.string().url(),
        transferPath: z.enum(['direct', 'relay', 'storage']),
      })
      const parsed = schema.safeParse(payload)
      if (!parsed.success) return

      io.to(session.code).emit('file-transfer-complete', {
        ...parsed.data,
        senderParticipantId: session.participantId,
      })
    })

    socket.on('leave-room', async () => {
      if (!session) return

      const { code, participantId } = session
      await roomStore.unbindSocket(code, participantId)
      await socket.leave(code)
      const room = await roomStore.getRoom(code)
      if (room) {
        io.to(code).emit('room-state', toPublicRoom(room))
      }
      session = null
    })

    socket.on('disconnect', async () => {
      if (!session) return

      const { code, participantId } = session
      const room = await roomStore.removeParticipant(code, participantId)
      if (room) {
        io.to(code).emit('room-state', toPublicRoom(room))
      } else {
        io.to(code).emit('room-expired')
      }
      session = null
    })
  })

  return io
}
