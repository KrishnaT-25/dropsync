import type { Server as HttpServer } from 'node:http'
import type { Redis } from 'ioredis'
import { createAdapter } from '@socket.io/redis-adapter'
import { Server } from 'socket.io'
import { z } from 'zod'
import { config } from '../config.js'
import {
  RATE_LIMITS,
  checkRateLimit,
  clientIpFromSocket,
} from '../services/rateLimit.js'
import { roomStore } from '../store/roomStore.js'
import { waitingParticipants } from '../store/meetingStore.js'
import type { ActivityItem, MeetingRecord } from '../types.js'
import { toPublicRoom } from '../utils/publicRoom.js'
import { isValidRoomCode, normalizeRoomCode } from '../utils/roomCode.js'
import { registerMeetingSocketHandlers } from './meetings.js'
import { trackSocketCleanup } from './cleanupTasks.js'

const joinSchema = z.object({
  code: z.string(),
  participantId: z.string().uuid(),
  accessToken: z.string().min(20),
})

const activitySchema = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(['message', 'link', 'clipboard', 'code', 'meeting']),
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

const fileSignalSchema = z.object({
  targetParticipantId: z.string().uuid(),
  senderParticipantId: z.string().uuid(),
  payload: z.unknown(),
})

interface RoomSocketSession {
  code: string
  participantId: string
  senderName: string
}

let roomIo: Server | null = null
export function broadcastRoomActivity(code: string, item: ActivityItem): void {
  roomIo?.to(code).emit('activity', item)
}
export function broadcastRoomState(code: string, room: ReturnType<typeof toPublicRoom>): void {
  roomIo?.to(code).emit('room-state', room)
}
export function broadcastMeetingWaiting(meeting: MeetingRecord): void {
  for (const person of meeting.participants) {
    if (person.admitted && (person.isHost || person.isCoHost) && person.socketId) {
      roomIo?.to(person.socketId).emit('meeting-waiting', waitingParticipants(meeting))
    }
  }
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
  roomIo = io

  if (redisClients) {
    io.adapter(createAdapter(redisClients.redisPub, redisClients.redisSub))
  }

  roomStore.setOnExpire((code) => {
    io.to(code).emit('room-expired')
    void io.in(code).socketsLeave(code)
  })

  roomStore.startExpiryPoller()

  io.on('connection', (socket) => {
    let roomSession: RoomSocketSession | null = null
    registerMeetingSocketHandlers(io, socket)

    socket.on('join-room', async (payload, ack) => {
      const ip = clientIpFromSocket(socket.handshake)
      const joinLimit = await checkRateLimit(
        `join-room:${ip}`,
        RATE_LIMITS.joinIp.max,
        RATE_LIMITS.joinIp.windowMs,
      )
      if (!joinLimit.allowed) {
        ack?.({ ok: false, error: 'Slow down a bit', code: 'rate_limited' })
        return
      }

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
      if (roomSession && (roomSession.code !== code || roomSession.participantId !== parsed.data.participantId)) {
        ack?.({ ok: false, error: 'Leave the current room before joining another' })
        return
      }

      const authorized = await roomStore.authorize(code, parsed.data.accessToken)
      if (!authorized || authorized.participantId !== parsed.data.participantId || authorized.room.status !== 'active') {
        ack?.({ ok: false, error: 'Room access denied' })
        return
      }
      const room = await roomStore.bindSocket(code, parsed.data.participantId, socket.id)
      if (!room) {
        ack?.({ ok: false, error: 'Room not found or participant invalid' })
        return
      }

      roomSession = { code, participantId: parsed.data.participantId,
        senderName: room.participants.find((person) => person.id === parsed.data.participantId)?.name ?? 'Guest' }
      await socket.join(code)

      ack?.({ ok: true, room: toPublicRoom(room) })
      socket.to(code).emit('room-state', toPublicRoom(room))
    })

    socket.on('activity', async (payload, ack) => {
      if (!roomSession) {
        ack?.({ ok: false, error: 'Not in a room' })
        return
      }

      const activityLimit = await checkRateLimit(
        `activity:${socket.id}`,
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

      const activity = await roomStore.addActivity(roomSession.code, {
        id: parsed.data.id,
        type: parsed.data.type,
        content: parsed.data.content,
        sender: roomSession.senderName,
        senderId: roomSession.participantId,
      })

      if (!activity) {
        ack?.({ ok: false, error: 'Room expired or unavailable' })
        return
      }
      io.to(roomSession.code).emit('activity', activity)
      ack?.({ ok: true, activity })
    })

    socket.on('system-activity', async (content: string) => {
      if (!roomSession || typeof content !== 'string' || !content.trim()) return

      const room = await roomStore.getRoom(roomSession.code, false)
      if (!room) return

      const participant = room.participants.find((p) => p.id === roomSession!.participantId)
      const activity = await roomStore.addActivity(roomSession.code, {
        type: 'meeting',
        content: content.trim(),
        sender: participant?.name ?? 'Guest',
        senderId: roomSession.participantId,
      })

      if (activity) {
        io.to(roomSession.code).emit('activity', activity as ActivityItem)
      }
    })

    const relayFileSignal = async (
      event: 'file-offer' | 'file-answer' | 'file-ice-candidate',
      payload: unknown,
    ) => {
      if (!roomSession) return
      const parsed = fileSignalSchema.safeParse(payload)
      if (!parsed.success) return
      if (parsed.data.senderParticipantId !== roomSession.participantId) return
      if (!(await roomStore.getRoom(roomSession.code, false))) return

      socket.to(roomSession.code).emit(event, parsed.data)
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
      if (!roomSession) return
      const schema = z.object({
        activityId: z.string(),
        transferId: z.string().uuid(),
        downloadUrl: z.string().url(),
        transferPath: z.enum(['direct', 'relay', 'storage']),
      })
      const parsed = schema.safeParse(payload)
      if (!parsed.success) return
      if (!(await roomStore.getRoom(roomSession.code, false))) return

      io.to(roomSession.code).emit('file-transfer-complete', {
        ...parsed.data,
        senderParticipantId: roomSession.participantId,
      })
    })

    socket.on('leave-room', async () => {
      if (!roomSession) return

      const { code, participantId } = roomSession
      await roomStore.unbindSocket(code, participantId, socket.id)
      await socket.leave(code)
      const room = await roomStore.getRoom(code)
      if (room) {
        io.to(code).emit('room-state', toPublicRoom(room))
      }
      roomSession = null
    })

    socket.on('disconnect', () => {
      trackSocketCleanup((async () => {
        if (!roomSession) return

        const { code, participantId } = roomSession
        const room = await roomStore.unbindSocket(code, participantId, socket.id)
        if (room) {
          io.to(code).emit('room-state', toPublicRoom(room))
        } else {
          const current = await roomStore.getRoom(code)
          if (current) io.to(code).emit('room-state', toPublicRoom(current))
          else io.to(code).emit('room-expired')
        }
        roomSession = null
      })())
    })
  })

  return io
}
