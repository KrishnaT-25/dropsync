import { v4 as uuidv4 } from 'uuid'
import type { Redis } from 'ioredis'
import { config } from '../config.js'
import { getRedis } from '../db/redis.js'
import type { MeetingParticipant, MeetingRecord, PublicMeetingRecord } from '../types.js'
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../utils/roomCode.js'

const MEETING_DATA_PREFIX = 'meeting:data:'
/** Meetings live longer than ephemeral share rooms (8h). */
const MEETING_TTL_SECONDS = 8 * 60 * 60
const MAX_UPDATE_ATTEMPTS = 50
const COMPARE_AND_SWAP = `
local current = redis.call('GET', KEYS[1])
if not current or current ~= ARGV[1] then return 0 end
if ARGV[2] == '' then
  redis.call('DEL', KEYS[1])
else
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl <= 0 then return 0 end
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ttl)
end
return 1
`

function meetingDataKey(code: string): string {
  return `${MEETING_DATA_PREFIX}${code}`
}

function parseMeeting(raw: string | null): MeetingRecord | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as MeetingRecord
  } catch {
    return null
  }
}

export function toPublicMeeting(meeting: MeetingRecord): PublicMeetingRecord {
  return {
    code: meeting.code,
    hostParticipantId: meeting.hostParticipantId,
    createdAt: meeting.createdAt,
    expiresAt: meeting.expiresAt,
    participants: meeting.participants.map(({ socketId: _s, ...p }) => p),
  }
}

export class MeetingStore {
  private redis(): Redis {
    return getRedis()
  }

  private async mutate<T>(
    code: string,
    change: (meeting: MeetingRecord) => { value: T; delete?: boolean } | null,
  ): Promise<{ meeting: MeetingRecord | null; value: T } | null> {
    const normalized = normalizeRoomCode(code)
    if (!isValidRoomCode(normalized)) return null
    const key = meetingDataKey(normalized)
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
      const raw = await this.redis().get(key)
      const meeting = parseMeeting(raw)
      if (!raw || !meeting) return null
      if (new Date(meeting.expiresAt).getTime() <= Date.now()) {
        await this.redis().eval(COMPARE_AND_SWAP, 1, key, raw, '')
        return null
      }
      const result = change(meeting)
      if (!result) return null
      const next = result.delete ? '' : JSON.stringify(meeting)
      const applied = await this.redis().eval(COMPARE_AND_SWAP, 1, key, raw, next)
      if (applied === 1) {
        return { meeting: result.delete ? null : structuredClone(meeting), value: result.value }
      }
    }
    throw new Error('Meeting update contention exceeded retry limit')
  }

  async createMeeting(): Promise<{ meeting: MeetingRecord; participantId: string }> {
    const participantId = uuidv4()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + MEETING_TTL_SECONDS * 1000)

    for (let attempt = 0; attempt < 20; attempt++) {
      const code = generateRoomCode()
      const host: MeetingParticipant = {
        id: participantId,
        name: 'Host',
        isHost: true,
        isMuted: false,
        isCameraOff: false,
        isScreenSharing: false,
      }
      const meeting: MeetingRecord = {
        code,
        hostParticipantId: participantId,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        participants: [host],
      }

      const created = await this.redis().set(
        meetingDataKey(code),
        JSON.stringify(meeting),
        'EX',
        MEETING_TTL_SECONDS,
        'NX',
      )
      if (created === 'OK') {
        return { meeting: structuredClone(meeting), participantId }
      }
    }

    throw new Error('Unable to allocate a unique meeting code')
  }

  async getMeeting(code: string): Promise<MeetingRecord | null> {
    const normalized = normalizeRoomCode(code)
    if (!isValidRoomCode(normalized)) return null
    const raw = await this.redis().get(meetingDataKey(normalized))
    const meeting = parseMeeting(raw)
    if (!meeting) return null
    if (new Date(meeting.expiresAt).getTime() <= Date.now()) {
      if (raw) await this.redis().eval(COMPARE_AND_SWAP, 1, meetingDataKey(normalized), raw, '')
      return null
    }
    return structuredClone(meeting)
  }

  async joinMeeting(
    code: string,
    displayName: string,
  ): Promise<{ meeting: MeetingRecord; participantId: string } | null> {
    const participantId = uuidv4()
    const participant: MeetingParticipant = {
      id: participantId,
      name: displayName.trim() || 'Guest',
      isHost: false,
      isMuted: false,
      isCameraOff: false,
      isScreenSharing: false,
    }
    const updated = await this.mutate(code, (meeting) => {
      if (meeting.participants.length >= 6) return null
      meeting.participants.push(participant)
      return { value: participantId }
    })
    return updated?.meeting ? { meeting: updated.meeting, participantId } : null
  }

  /** Host creates via REST then sets display name when joining the socket lobby. */
  async setParticipantName(
    code: string,
    participantId: string,
    name: string,
  ): Promise<MeetingRecord | null> {
    const updated = await this.mutate(code, (meeting) => {
      const participant = meeting.participants.find((p) => p.id === participantId)
      if (!participant) return null
      participant.name = name.trim() || participant.name
      return { value: undefined }
    })
    return updated?.meeting ?? null
  }

  async bindSocket(
    code: string,
    participantId: string,
    socketId: string,
  ): Promise<MeetingRecord | null> {
    const updated = await this.mutate(code, (meeting) => {
      const participant = meeting.participants.find((p) => p.id === participantId)
      if (!participant) return null
      participant.socketId = socketId
      return { value: undefined }
    })
    return updated?.meeting ?? null
  }

  async updateParticipantMedia(
    code: string,
    participantId: string,
    patch: Partial<Pick<MeetingParticipant, 'isMuted' | 'isCameraOff' | 'isScreenSharing'>>,
  ): Promise<MeetingRecord | null> {
    const updated = await this.mutate(code, (meeting) => {
      const participant = meeting.participants.find((p) => p.id === participantId)
      if (!participant) return null
      Object.assign(participant, patch)
      return { value: undefined }
    })
    return updated?.meeting ?? null
  }

  async forceMute(
    code: string,
    hostParticipantId: string,
    targetParticipantId: string,
  ): Promise<MeetingRecord | null> {
    const updated = await this.mutate(code, (meeting) => {
      if (meeting.hostParticipantId !== hostParticipantId) return null
      const target = meeting.participants.find((p) => p.id === targetParticipantId)
      if (!target || target.isHost) return null
      target.isMuted = true
      return { value: undefined }
    })
    return updated?.meeting ?? null
  }

  async removeParticipant(
    code: string,
    participantId: string,
  ): Promise<{ meeting: MeetingRecord | null; removed: MeetingParticipant | null }> {
    const updated = await this.mutate(code, (meeting) => {
      const index = meeting.participants.findIndex((p) => p.id === participantId)
      const removed = index === -1 ? null : meeting.participants.splice(index, 1)[0]!
      return { value: removed, delete: meeting.participants.length === 0 }
    })
    return { meeting: updated?.meeting ?? null, removed: updated?.value ?? null }
  }

  async hostRemove(
    code: string,
    hostParticipantId: string,
    targetParticipantId: string,
  ): Promise<{ meeting: MeetingRecord | null; removed: MeetingParticipant | null } | null> {
    const updated = await this.mutate(code, (meeting) => {
      if (meeting.hostParticipantId !== hostParticipantId || targetParticipantId === hostParticipantId) return null
      const index = meeting.participants.findIndex((p) => p.id === targetParticipantId)
      const removed = index === -1 ? null : meeting.participants.splice(index, 1)[0]!
      return { value: removed, delete: meeting.participants.length === 0 }
    })
    return updated ? { meeting: updated.meeting, removed: updated.value } : null
  }

  async deleteMeeting(code: string): Promise<void> {
    const normalized = normalizeRoomCode(code)
    await this.redis().del(meetingDataKey(normalized))
  }

  /** Unused today; kept for TTL buffer parity with rooms. */
  remainingBufferSeconds(): number {
    return config.roomDataTtlBufferSeconds
  }
}

export const meetingStore = new MeetingStore()
