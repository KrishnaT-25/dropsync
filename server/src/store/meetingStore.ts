import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import type { Redis } from 'ioredis'
import { config } from '../config.js'
import { getRedis } from '../db/redis.js'
import type { MeetingParticipant, MeetingPermissions, MeetingRecord, PublicMeetingRecord } from '../types.js'
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

function createAccessToken(): string {
  return randomBytes(32).toString('base64url')
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function tokenMatches(participant: MeetingParticipant, token: string): boolean {
  if (!participant.accessTokenHash || !token) return false
  const actual = Buffer.from(tokenHash(token), 'hex')
  const expected = Buffer.from(participant.accessTokenHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function canModerate(meeting: MeetingRecord, participantId: string): boolean {
  const participant = meeting.participants.find((person) => person.id === participantId)
  return Boolean(participant?.admitted && (participant.isHost || participant.isCoHost))
}

export function waitingParticipants(meeting: MeetingRecord): Array<{ id: string; name: string }> {
  return meeting.participants.filter((person) => !person.admitted).map(({ id, name }) => ({ id, name }))
}

export function toPublicMeeting(meeting: MeetingRecord): PublicMeetingRecord {
  return {
    code: meeting.code,
    hostParticipantId: meeting.hostParticipantId,
    createdAt: meeting.createdAt,
    expiresAt: meeting.expiresAt,
    permissions: meeting.permissions,
    participants: meeting.participants.filter((person) => person.admitted).map(
      ({ socketId: _socketId, accessTokenHash: _tokenHash, admitted: _admitted, ...person }) => person,
    ),
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

  async createMeeting(): Promise<{ meeting: MeetingRecord; participantId: string; accessToken: string }> {
    const participantId = uuidv4()
    const accessToken = createAccessToken()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + MEETING_TTL_SECONDS * 1000)

    for (let attempt = 0; attempt < 20; attempt++) {
      const code = generateRoomCode()
      const host: MeetingParticipant = {
        id: participantId,
        name: 'Host',
        isHost: true,
        isCoHost: false,
        admitted: true,
        accessTokenHash: tokenHash(accessToken),
        isMuted: false,
        isCameraOff: false,
        isScreenSharing: false,
      }
      const meeting: MeetingRecord = {
        code,
        hostParticipantId: participantId,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        permissions: { requireAdmission: true, allowScreenShare: true, allowParticipantUnmute: true },
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
        return { meeting: structuredClone(meeting), participantId, accessToken }
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
  ): Promise<{ meeting: MeetingRecord; participantId: string; accessToken: string } | null> {
    const participantId = uuidv4()
    const accessToken = createAccessToken()
    const participant: MeetingParticipant = {
      id: participantId,
      name: displayName.trim() || 'Guest',
      isHost: false,
      isCoHost: false,
      admitted: true,
      accessTokenHash: tokenHash(accessToken),
      isMuted: false,
      isCameraOff: false,
      isScreenSharing: false,
    }
    const updated = await this.mutate(code, (meeting) => {
      if (meeting.participants.length >= 6) return null
      participant.admitted = !meeting.permissions.requireAdmission
      meeting.participants.push(participant)
      return { value: participantId }
    })
    return updated?.meeting ? { meeting: updated.meeting, participantId, accessToken } : null
  }

  async bindSocket(
    code: string,
    participantId: string,
    accessToken: string,
    socketId: string,
    name: string,
  ): Promise<{ meeting: MeetingRecord; admitted: boolean } | null> {
    const updated = await this.mutate(code, (meeting) => {
      const participant = meeting.participants.find((p) => p.id === participantId)
      if (!participant || !tokenMatches(participant, accessToken)) return null
      participant.socketId = socketId
      participant.name = name.trim() || participant.name
      return { value: participant.admitted }
    })
    return updated?.meeting ? { meeting: updated.meeting, admitted: updated.value } : null
  }

  async setPermissions(
    code: string,
    hostParticipantId: string,
    patch: Partial<MeetingPermissions>,
  ): Promise<MeetingRecord | null> {
    const updated = await this.mutate(code, (meeting) => {
      if (meeting.hostParticipantId !== hostParticipantId) return null
      Object.assign(meeting.permissions, patch)
      for (const person of meeting.participants) {
        if (person.isHost || person.isCoHost) continue
        if (!meeting.permissions.allowParticipantUnmute) person.isMuted = true
        if (!meeting.permissions.allowScreenShare) person.isScreenSharing = false
      }
      return { value: undefined }
    })
    return updated?.meeting ?? null
  }

  async setCoHost(
    code: string,
    hostParticipantId: string,
    targetParticipantId: string,
    enabled: boolean,
  ): Promise<MeetingRecord | null> {
    const updated = await this.mutate(code, (meeting) => {
      if (meeting.hostParticipantId !== hostParticipantId) return null
      const target = meeting.participants.find((person) => person.id === targetParticipantId)
      if (!target?.admitted || target.isHost) return null
      target.isCoHost = enabled
      return { value: undefined }
    })
    return updated?.meeting ?? null
  }

  async admitParticipant(
    code: string,
    moderatorParticipantId: string,
    targetParticipantId: string,
  ): Promise<{ meeting: MeetingRecord; admitted: MeetingParticipant } | null> {
    const updated = await this.mutate(code, (meeting) => {
      if (!canModerate(meeting, moderatorParticipantId)) return null
      const target = meeting.participants.find((person) => person.id === targetParticipantId)
      if (!target || target.admitted) return null
      target.admitted = true
      return { value: structuredClone(target) }
    })
    return updated?.meeting ? { meeting: updated.meeting, admitted: updated.value } : null
  }

  async updateParticipantMedia(
    code: string,
    participantId: string,
    patch: Partial<Pick<MeetingParticipant, 'isMuted' | 'isCameraOff' | 'isScreenSharing'>>,
  ): Promise<MeetingRecord | null> {
    const updated = await this.mutate(code, (meeting) => {
      const participant = meeting.participants.find((p) => p.id === participantId)
      if (!participant?.admitted) return null
      if (!canModerate(meeting, participantId)) {
        if (patch.isScreenSharing && !meeting.permissions.allowScreenShare) return null
        if (patch.isMuted === false && !meeting.permissions.allowParticipantUnmute) return null
      }
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
      if (!canModerate(meeting, hostParticipantId)) return null
      const target = meeting.participants.find((p) => p.id === targetParticipantId)
      if (!target?.admitted || target.isHost || (target.isCoHost && meeting.hostParticipantId !== hostParticipantId)) return null
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
      if (!canModerate(meeting, hostParticipantId) || targetParticipantId === meeting.hostParticipantId) return null
      const index = meeting.participants.findIndex((p) => p.id === targetParticipantId)
      if (index !== -1 && meeting.participants[index]!.isCoHost && meeting.hostParticipantId !== hostParticipantId) return null
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
