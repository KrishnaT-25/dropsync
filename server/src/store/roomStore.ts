import { v4 as uuidv4 } from 'uuid'
import { config } from '../config.js'
import type { ActivityItem, Participant, RoomRecord } from '../types.js'
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../utils/roomCode.js'

const rooms = new Map<string, RoomRecord>()
const expiryTimers = new Map<string, NodeJS.Timeout>()

function scheduleExpiry(code: string, expiresAt: Date, onExpire: (code: string) => void) {
  const existing = expiryTimers.get(code)
  if (existing) clearTimeout(existing)

  const delay = expiresAt.getTime() - Date.now()
  if (delay <= 0) {
    onExpire(code)
    return
  }

  const timer = setTimeout(() => onExpire(code), delay)
  expiryTimers.set(code, timer)
}

function createActivity(type: ActivityItem['type'], content: string, sender?: string, senderId?: string): ActivityItem {
  return {
    id: uuidv4(),
    type,
    content,
    sender,
    senderId,
    timestamp: new Date().toISOString(),
  }
}

export class RoomStore {
  private onExpire?: (code: string) => void

  setOnExpire(handler: (code: string) => void) {
    this.onExpire = handler
  }

  createRoom(): { room: RoomRecord; participantId: string } {
    let code = generateRoomCode()
    while (rooms.has(code)) {
      code = generateRoomCode()
    }

    const now = new Date()
    const expiresAt = new Date(now.getTime() + config.roomDurationSeconds * 1000)
    const participantId = uuidv4()

    const room: RoomRecord = {
      code,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      participants: [{ id: participantId, name: 'You' }],
      activities: [
        createActivity('system', 'Room created — share the code or QR to invite others'),
      ],
      meetingActive: false,
    }

    rooms.set(code, room)
    scheduleExpiry(code, expiresAt, (c) => this.expireRoom(c))

    return { room: structuredClone(room), participantId }
  }

  getRoom(code: string): RoomRecord | null {
    const normalized = normalizeRoomCode(code)
    if (!isValidRoomCode(normalized)) return null

    const room = rooms.get(normalized)
    if (!room) return null

    if (new Date(room.expiresAt).getTime() <= Date.now()) {
      this.deleteRoom(normalized)
      return null
    }

    return structuredClone(room)
  }

  joinRoom(code: string, displayName = 'Guest'): { room: RoomRecord; participantId: string } | null {
    const normalized = normalizeRoomCode(code)
    const room = this.getRoom(normalized)
    if (!room) return null

    const participantId = uuidv4()
    const participant: Participant = { id: participantId, name: displayName }
    const liveRoom = rooms.get(normalized)!
    liveRoom.participants.push(participant)
    liveRoom.activities.push(
      createActivity('system', `${displayName} joined the room`, displayName, participantId),
    )

    return { room: structuredClone(liveRoom), participantId }
  }

  bindSocket(code: string, participantId: string, socketId: string): RoomRecord | null {
    const normalized = normalizeRoomCode(code)
    const room = rooms.get(normalized)
    if (!room) return null

    const participant = room.participants.find((p) => p.id === participantId)
    if (!participant) return null

    participant.socketId = socketId
    return structuredClone(room)
  }

  unbindSocket(code: string, participantId: string): RoomRecord | null {
    const normalized = normalizeRoomCode(code)
    const room = rooms.get(normalized)
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
    return structuredClone(room)
  }

  removeParticipant(code: string, participantId: string): RoomRecord | null {
    const normalized = normalizeRoomCode(code)
    const room = rooms.get(normalized)
    if (!room) return null

    const index = room.participants.findIndex((p) => p.id === participantId)
    if (index === -1) return structuredClone(room)

    const [removed] = room.participants.splice(index, 1)
    room.activities.push(
      createActivity('system', `${removed.name} left the room`, removed.name, removed.id),
    )
    room.meetingActive = room.participants.some((p) => p.inMeeting)

    if (room.participants.length === 0) {
      this.deleteRoom(normalized)
      return null
    }

    return structuredClone(room)
  }

  addActivity(code: string, activity: Omit<ActivityItem, 'id' | 'timestamp'>): ActivityItem | null {
    const normalized = normalizeRoomCode(code)
    const room = rooms.get(normalized)
    if (!room) return null

    const item: ActivityItem = {
      ...activity,
      id: uuidv4(),
      timestamp: new Date().toISOString(),
    }
    room.activities.push(item)
    return structuredClone(item)
  }

  updateMeetingState(
    code: string,
    participantId: string,
    patch: Partial<Pick<Participant, 'inMeeting' | 'isMuted' | 'isCameraOff' | 'isScreenSharing'>>,
  ): RoomRecord | null {
    const normalized = normalizeRoomCode(code)
    const room = rooms.get(normalized)
    if (!room) return null

    const participant = room.participants.find((p) => p.id === participantId)
    if (!participant) return null

    Object.assign(participant, patch)
    room.meetingActive = room.participants.some((p) => p.inMeeting)
    return structuredClone(room)
  }

  expireRoom(code: string) {
    this.onExpire?.(code)
    this.deleteRoom(code)
  }

  deleteRoom(code: string) {
    const normalized = normalizeRoomCode(code)
    const timer = expiryTimers.get(normalized)
    if (timer) {
      clearTimeout(timer)
      expiryTimers.delete(normalized)
    }
    rooms.delete(normalized)
  }
}

export const roomStore = new RoomStore()
