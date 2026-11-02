import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import { config } from '../config.js'
import { getRedis } from '../db/redis.js'
import { DurableRoom, type DurableRoomDocument } from '../models/DurableRoom.js'
import { RoomActivity } from '../models/RoomActivity.js'
import { RoomGrant } from '../models/RoomGrant.js'
import type { ActivityItem, RoomRecord } from '../types.js'
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../utils/roomCode.js'

const EXPIRIES_KEY = 'room:expiries'

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function secret(): string {
  return randomBytes(32).toString('base64url')
}

function activity(type: ActivityItem['type'], content: string, sender?: string, senderId?: string): ActivityItem {
  return { id: uuidv4(), type, content, sender, senderId, timestamp: new Date().toISOString() }
}

export class RoomStore {
  private onExpire?: (code: string) => void
  private poller: NodeJS.Timeout | null = null

  setOnExpire(handler: (code: string) => void) { this.onExpire = handler }

  startExpiryPoller(intervalMs = 1000): void {
    if (this.poller) return
    this.poller = setInterval(() => { void this.sweepExpiredRooms() }, intervalMs)
    this.poller.unref?.()
  }

  stopExpiryPoller(): void {
    if (this.poller) clearInterval(this.poller)
    this.poller = null
  }

  private async sweepExpiredRooms(): Promise<void> {
    try {
      const due = await getRedis().zrangebyscore(EXPIRIES_KEY, 0, Date.now())
      for (const code of due) await this.expireRoom(code)
    } catch (error) {
      console.error('[rooms] expiry sweep failed', error)
    }
  }

  private async snapshot(doc: DurableRoomDocument, includeActivities = true): Promise<RoomRecord> {
    const rows = includeActivities
      ? await RoomActivity.find({ roomCode: doc.code }).sort({ timestamp: 1 }).lean()
      : []
    return {
      code: doc.code,
      name: doc.name || 'Untitled room',
      createdAt: doc.createdAt.toISOString(),
      expiresAt: doc.expiresAt.toISOString(),
      recoveryDeadline: doc.recoveryDeadline.toISOString(),
      durationMinutes: doc.durationMinutes,
      status: doc.status,
      storageBytes: doc.storageBytes,
      reservedBytes: doc.reservedBytes,
      participants: doc.participants.map((p) => ({ id: p.id, name: p.name, socketId: p.socketId })),
      activities: rows.map((row) => ({
        id: row.id, type: row.type, content: row.content, sender: row.sender,
        senderId: row.senderId, timestamp: row.timestamp, fileMeta: row.fileMeta,
      })),
      passwordHash: doc.passwordHash,
    }
  }

  private async current(code: string): Promise<DurableRoomDocument | null> {
    let doc = await DurableRoom.findOne({ code })
    if (!doc) return null
    if (doc.status === 'active' && doc.expiresAt.getTime() <= Date.now()) {
      await this.expireRoom(code)
      doc = await DurableRoom.findOne({ code })
      if (!doc) return null
    }
    if (doc.status === 'expired_recoverable' && doc.recoveryDeadline.getTime() <= Date.now()) {
      await DurableRoom.updateOne(
        { code, status: 'expired_recoverable', recoveryDeadline: { $lte: new Date() } },
        { $set: { status: 'deleting', closedAt: new Date() } },
      )
      return DurableRoom.findOne({ code })
    }
    return doc
  }

  async createRoom(passwordHash?: string, durationMinutes = 5, name = 'Untitled room'): Promise<{
    room: RoomRecord; participantId: string; accessToken: string; recoveryKey: string
  }> {
    const participantId = randomUUID()
    const accessToken = secret()
    const recoveryKey = secret()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + durationMinutes * 60_000)
    const recoveryDeadline = new Date(expiresAt.getTime() + config.recoveryHours * 3_600_000)
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = generateRoomCode()
      try {
        const doc = await DurableRoom.create({
          code, name, createdAt: now, expiresAt, recoveryDeadline, durationMinutes, status: 'active',
          passwordHash, recoveryHash: hashSecret(recoveryKey),
          participants: [{ id: participantId, name: 'Host' }],
          storageBytes: 0, reservedBytes: 0, cleanupAttempts: 0,
        })
        await RoomGrant.create({ roomCode: code, participantId, tokenHash: hashSecret(accessToken) })
        await RoomActivity.create({ roomCode: code, ...activity('system', 'Room created — share the code or QR to invite others') })
        await getRedis().zadd(EXPIRIES_KEY, expiresAt.getTime(), code)
        await getRedis().set(`room:data:${code}`, 'active', 'EX', durationMinutes * 60 + 60)
        return { room: await this.snapshot(doc), participantId, accessToken, recoveryKey }
      } catch (error: unknown) {
        if ((error as { code?: number }).code !== 11000) throw error
      }
    }
    throw new Error('Unable to allocate a unique room code')
  }

  async getRoomAny(code: string, includeActivities = true): Promise<RoomRecord | null> {
    const normalized = normalizeRoomCode(code)
    if (!isValidRoomCode(normalized)) return null
    const doc = await this.current(normalized)
    if (!doc || doc.status === 'deleted') return null
    return this.snapshot(doc, includeActivities)
  }

  async preview(code: string): Promise<{ code: string; status: string; hasPassword: boolean } | null> {
    const normalized = normalizeRoomCode(code)
    if (!isValidRoomCode(normalized)) return null
    const doc = await this.current(normalized)
    if (!doc || doc.status === 'deleting' || doc.status === 'deleted') return null
    return { code: doc.code, status: doc.status, hasPassword: Boolean(doc.passwordHash) }
  }

  async getRoom(code: string, includeActivities = true): Promise<RoomRecord | null> {
    const room = await this.getRoomAny(code, includeActivities)
    return room?.status === 'active' ? room : null
  }

  async authorize(code: string, token: string, includeActivities = true): Promise<{ room: RoomRecord; participantId: string } | null> {
    if (!token || token.length > 256) return null
    const normalized = normalizeRoomCode(code)
    const grant = await RoomGrant.findOne({ roomCode: normalized, tokenHash: hashSecret(token) })
    if (!grant) return null
    const room = await this.getRoomAny(normalized, includeActivities)
    if (!room || room.status === 'deleting') return null
    return { room, participantId: grant.participantId }
  }

  async verifyRecoveryKey(code: string, recoveryKey: string): Promise<boolean> {
    if (!recoveryKey || recoveryKey.length > 256) return false
    const doc = await this.current(normalizeRoomCode(code))
    return Boolean(doc && doc.status !== 'deleted' && doc.recoveryHash === hashSecret(recoveryKey))
  }

  async joinRoom(code: string, displayName = 'Guest'): Promise<{
    room: RoomRecord; participantId: string; accessToken: string
  } | null> {
    const normalized = normalizeRoomCode(code)
    const doc = await this.current(normalized)
    if (!doc || doc.status !== 'active') return null
    const participantId = randomUUID()
    const accessToken = secret()
    const updated = await DurableRoom.findOneAndUpdate(
      { code: normalized, status: 'active', expiresAt: { $gt: new Date() } },
      { $push: { participants: { id: participantId, name: displayName } } },
      { returnDocument: 'after' },
    )
    if (!updated) return null
    await RoomGrant.create({ roomCode: normalized, participantId, tokenHash: hashSecret(accessToken) })
    await RoomActivity.create({ roomCode: normalized, ...activity('system', `${displayName} joined the room`, displayName, participantId) })
    return { room: await this.snapshot(updated), participantId, accessToken }
  }

  async bindSocket(code: string, participantId: string, socketId: string): Promise<RoomRecord | null> {
    const normalized = normalizeRoomCode(code)
    const updated = await DurableRoom.findOneAndUpdate(
      { code: normalized, status: 'active', expiresAt: { $gt: new Date() }, 'participants.id': participantId },
      { $set: { 'participants.$.socketId': socketId } },
      { returnDocument: 'after' },
    )
    return updated ? this.snapshot(updated) : null
  }

  async unbindSocket(code: string, participantId: string, socketId?: string): Promise<RoomRecord | null> {
    const normalized = normalizeRoomCode(code)
    const updated = await DurableRoom.findOneAndUpdate(
      { code: normalized, ...(socketId
        ? { participants: { $elemMatch: { id: participantId, socketId } } }
        : { 'participants.id': participantId }) },
      { $unset: { 'participants.$.socketId': 1 } },
      { returnDocument: 'after' },
    )
    return updated ? this.snapshot(updated) : null
  }

  async removeParticipant(code: string, participantId: string): Promise<RoomRecord | null> {
    return this.unbindSocket(code, participantId)
  }

  async addActivity(code: string, input: Omit<ActivityItem, 'id' | 'timestamp'>): Promise<ActivityItem | null> {
    const room = await this.getRoom(code, false)
    if (!room) return null
    const item: ActivityItem = { ...input, id: uuidv4(), timestamp: new Date().toISOString() }
    await RoomActivity.create({ roomCode: room.code, ...item })
    return item
  }

  async expireRoom(code: string): Promise<void> {
    const normalized = normalizeRoomCode(code)
    const updated = await DurableRoom.findOneAndUpdate(
      { code: normalized, status: 'active', expiresAt: { $lte: new Date() } },
      { $set: { status: 'expired_recoverable', closedAt: new Date() } },
      { returnDocument: 'after' },
    )
    await getRedis().zrem(EXPIRIES_KEY, normalized)
    await getRedis().del(`room:data:${normalized}`)
    if (updated) this.onExpire?.(normalized)
  }

  async reopen(code: string, recoveryKey: string): Promise<{ room: RoomRecord; participantId: string; accessToken: string } | null> {
    const normalized = normalizeRoomCode(code)
    if (!(await this.verifyRecoveryKey(normalized, recoveryKey))) return null
    const doc = await this.current(normalized)
    if (!doc || doc.status !== 'expired_recoverable') return null
    const now = new Date()
    const expiresAt = new Date(now.getTime() + doc.durationMinutes * 60_000)
    const recoveryDeadline = new Date(expiresAt.getTime() + config.recoveryHours * 3_600_000)
    const updated = await DurableRoom.findOneAndUpdate(
      { code: normalized, status: 'expired_recoverable', recoveryDeadline: { $gt: now } },
      { $set: { status: 'active', expiresAt, recoveryDeadline }, $unset: { closedAt: 1 } },
      { returnDocument: 'after' },
    )
    if (!updated) return null
    await getRedis().zadd(EXPIRIES_KEY, expiresAt.getTime(), normalized)
    await getRedis().set(`room:data:${normalized}`, 'active', 'EX', doc.durationMinutes * 60 + 60)
    const participantId = updated.participants[0]?.id ?? randomUUID()
    const accessToken = secret()
    await RoomGrant.create({ roomCode: normalized, participantId, tokenHash: hashSecret(accessToken) })
    return { room: await this.snapshot(updated), participantId, accessToken }
  }

  async deleteRoom(code: string): Promise<void> {
    const normalized = normalizeRoomCode(code)
    await DurableRoom.updateOne(
      { code: normalized, status: { $in: ['active', 'expired_recoverable'] } },
      { $set: { status: 'deleting', closedAt: new Date() } },
    )
    await getRedis().zrem(EXPIRIES_KEY, normalized)
    await getRedis().del(`room:data:${normalized}`)
    this.onExpire?.(normalized)
  }
}

export const roomStore = new RoomStore()
