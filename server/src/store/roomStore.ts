import { v4 as uuidv4 } from 'uuid'
import type { Redis } from 'ioredis'
import { config } from '../config.js'
import { getRedis } from '../db/redis.js'
import { recordRoomHistory } from '../services/roomHistory.js'
import type { ActivityItem, Participant, RoomRecord } from '../types.js'
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../utils/roomCode.js'

const ROOM_DATA_PREFIX = 'room:data:'
const ROOM_EXPIRIES_KEY = 'room:expiries'
const ROOM_EXPIRING_PREFIX = 'room:expiring:'

function roomDataKey(code: string): string {
  return `${ROOM_DATA_PREFIX}${code}`
}

function createActivity(
  type: ActivityItem['type'],
  content: string,
  sender?: string,
  senderId?: string,
): ActivityItem {
  return {
    id: uuidv4(),
    type,
    content,
    sender,
    senderId,
    timestamp: new Date().toISOString(),
  }
}

function parseRoom(raw: string | null): RoomRecord | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as RoomRecord
  } catch {
    return null
  }
}

export class RoomStore {
  private onExpire?: (code: string) => void
  private poller: NodeJS.Timeout | null = null

  setOnExpire(handler: (code: string) => void) {
    this.onExpire = handler
  }

  private redis(): Redis {
    return getRedis()
  }

  private remainingTtlSeconds(expiresAt: string): number {
    return Math.max(
      1,
      Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000) + config.roomDataTtlBufferSeconds,
    )
  }

  private async saveRoom(room: RoomRecord): Promise<void> {
    const code = room.code
    const ttl = this.remainingTtlSeconds(room.expiresAt)
    const multi = this.redis().multi()
    multi.set(roomDataKey(code), JSON.stringify(room), 'EX', ttl)
    multi.zadd(ROOM_EXPIRIES_KEY, new Date(room.expiresAt).getTime(), code)
    await multi.exec()
  }

  private async readRoom(code: string): Promise<RoomRecord | null> {
    return parseRoom(await this.redis().get(roomDataKey(code)))
  }

  private async deleteRoomKeys(code: string): Promise<void> {
    const multi = this.redis().multi()
    multi.del(roomDataKey(code))
    multi.zrem(ROOM_EXPIRIES_KEY, code)
    multi.del(`${ROOM_EXPIRING_PREFIX}${code}`)
    await multi.exec()
  }

  startExpiryPoller(intervalMs = 1000): void {
    if (this.poller) return

    this.poller = setInterval(() => {
      void this.sweepExpiredRooms()
    }, intervalMs)

    // Don't keep the process alive solely for the poller during tests/shutdowns.
    this.poller.unref?.()
  }

  stopExpiryPoller(): void {
    if (this.poller) {
      clearInterval(this.poller)
      this.poller = null
    }
  }

  private async sweepExpiredRooms(): Promise<void> {
    const now = Date.now()
    const due = await this.redis().zrangebyscore(ROOM_EXPIRIES_KEY, 0, now)
    for (const code of due) {
      await this.expireRoom(code)
    }
  }

  async createRoom(passwordHash?: string): Promise<{ room: RoomRecord; participantId: string }> {
    const participantId = uuidv4()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + config.roomDurationSeconds * 1000)

    for (let attempt = 0; attempt < 20; attempt++) {
      const code = generateRoomCode()
      const room: RoomRecord = {
        code,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        participants: [{ id: participantId, name: 'You' }],
        activities: [
          createActivity('system', 'Room created — share the code or QR to invite others'),
        ],
        meetingActive: false,
        ...(passwordHash ? { passwordHash } : {}),
      }

      const ttl = this.remainingTtlSeconds(room.expiresAt)
      const created = await this.redis().set(
        roomDataKey(code),
        JSON.stringify(room),
        'EX',
        ttl,
        'NX',
      )

      if (created === 'OK') {
        await this.redis().zadd(ROOM_EXPIRIES_KEY, expiresAt.getTime(), code)
        return { room: structuredClone(room), participantId }
      }
    }

    throw new Error('Unable to allocate a unique room code')
  }

  async getRoom(code: string): Promise<RoomRecord | null> {
    const normalized = normalizeRoomCode(code)
    if (!isValidRoomCode(normalized)) return null

    const room = await this.readRoom(normalized)
    if (!room) return null

    if (new Date(room.expiresAt).getTime() <= Date.now()) {
      await this.expireRoom(normalized)
      return null
    }

    return structuredClone(room)
  }

  async joinRoom(
    code: string,
    displayName = 'Guest',
  ): Promise<{ room: RoomRecord; participantId: string } | null> {
    const normalized = normalizeRoomCode(code)
    const room = await this.getRoom(normalized)
    if (!room) return null

    const participantId = uuidv4()
    const participant: Participant = { id: participantId, name: displayName }
    room.participants.push(participant)
    room.activities.push(
      createActivity('system', `${displayName} joined the room`, displayName, participantId),
    )

    await this.saveRoom(room)
    return { room: structuredClone(room), participantId }
  }

  async bindSocket(
    code: string,
    participantId: string,
    socketId: string,
  ): Promise<RoomRecord | null> {
    const normalized = normalizeRoomCode(code)
    const room = await this.readRoom(normalized)
    if (!room) return null
    if (new Date(room.expiresAt).getTime() <= Date.now()) {
      await this.expireRoom(normalized)
      return null
    }

    const participant = room.participants.find((p) => p.id === participantId)
    if (!participant) return null

    participant.socketId = socketId
    await this.saveRoom(room)
    return structuredClone(room)
  }

  async unbindSocket(code: string, participantId: string): Promise<RoomRecord | null> {
    const normalized = normalizeRoomCode(code)
    const room = await this.readRoom(normalized)
    if (!room) return null

    const participant = room.participants.find((p) => p.id === participantId)
    if (participant) {
      participant.socketId = undefined
      participant.inMeeting = false
      participant.isMuted = false
      participant.isCameraOff = false
      participant.isScreenSharing = false
    }

    room.meetingActive = room.participants.some((p) => p.inMeeting)
    await this.saveRoom(room)
    return structuredClone(room)
  }

  async removeParticipant(code: string, participantId: string): Promise<RoomRecord | null> {
    const normalized = normalizeRoomCode(code)
    const room = await this.readRoom(normalized)
    if (!room) return null

    const index = room.participants.findIndex((p) => p.id === participantId)
    if (index === -1) return structuredClone(room)

    const [removed] = room.participants.splice(index, 1)
    room.activities.push(
      createActivity('system', `${removed.name} left the room`, removed.name, removed.id),
    )
    room.meetingActive = room.participants.some((p) => p.inMeeting)

    if (room.participants.length === 0) {
      await this.deleteRoom(normalized, room, 'deleted')
      return null
    }

    await this.saveRoom(room)
    return structuredClone(room)
  }

  async addActivity(
    code: string,
    activity: Omit<ActivityItem, 'id' | 'timestamp'>,
  ): Promise<ActivityItem | null> {
    const normalized = normalizeRoomCode(code)
    const room = await this.readRoom(normalized)
    if (!room) return null
    if (new Date(room.expiresAt).getTime() <= Date.now()) {
      await this.expireRoom(normalized)
      return null
    }

    const item: ActivityItem = {
      ...activity,
      id: uuidv4(),
      timestamp: new Date().toISOString(),
    }
    room.activities.push(item)
    await this.saveRoom(room)
    return structuredClone(item)
  }

  async updateMeetingState(
    code: string,
    participantId: string,
    patch: Partial<Pick<Participant, 'inMeeting' | 'isMuted' | 'isCameraOff' | 'isScreenSharing'>>,
  ): Promise<RoomRecord | null> {
    const normalized = normalizeRoomCode(code)
    const room = await this.readRoom(normalized)
    if (!room) return null
    if (new Date(room.expiresAt).getTime() <= Date.now()) {
      await this.expireRoom(normalized)
      return null
    }

    const participant = room.participants.find((p) => p.id === participantId)
    if (!participant) return null

    Object.assign(participant, patch)
    room.meetingActive = room.participants.some((p) => p.inMeeting)
    await this.saveRoom(room)
    return structuredClone(room)
  }

  async expireRoom(code: string): Promise<void> {
    const normalized = normalizeRoomCode(code)
    const claimed = await this.redis().set(
      `${ROOM_EXPIRING_PREFIX}${normalized}`,
      '1',
      'EX',
      30,
      'NX',
    )
    if (claimed !== 'OK') return

    const room = await this.readRoom(normalized)
    if (room) {
      await recordRoomHistory(room, 'expired')
    }

    this.onExpire?.(normalized)
    await this.deleteRoomKeys(normalized)
  }

  async deleteRoom(
    code: string,
    snapshot?: RoomRecord | null,
    reason: 'expired' | 'deleted' = 'deleted',
  ): Promise<void> {
    const normalized = normalizeRoomCode(code)
    const room = snapshot ?? (await this.readRoom(normalized))
    if (room && reason === 'deleted') {
      await recordRoomHistory(room, 'deleted')
    }
    await this.deleteRoomKeys(normalized)
  }
}

export const roomStore = new RoomStore()
