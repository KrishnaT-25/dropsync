import { v4 as uuidv4 } from 'uuid'
import type { Redis } from 'ioredis'
import { config } from '../config.js'
import { getRedis } from '../db/redis.js'
import type { MeetingParticipant, MeetingRecord, PublicMeetingRecord } from '../types.js'
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../utils/roomCode.js'

const MEETING_DATA_PREFIX = 'meeting:data:'
/** Meetings live longer than ephemeral share rooms (8h). */
const MEETING_TTL_SECONDS = 8 * 60 * 60

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

  private async save(meeting: MeetingRecord): Promise<void> {
    const ttl = Math.max(
      60,
      Math.ceil((new Date(meeting.expiresAt).getTime() - Date.now()) / 1000),
    )
    await this.redis().set(meetingDataKey(meeting.code), JSON.stringify(meeting), 'EX', ttl)
  }

  private async read(code: string): Promise<MeetingRecord | null> {
    return parseMeeting(await this.redis().get(meetingDataKey(code)))
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
    const meeting = await this.read(normalized)
    if (!meeting) return null
    if (new Date(meeting.expiresAt).getTime() <= Date.now()) {
      await this.deleteMeeting(normalized)
      return null
    }
    return structuredClone(meeting)
  }

  async joinMeeting(
    code: string,
    displayName: string,
  ): Promise<{ meeting: MeetingRecord; participantId: string } | null> {
    const meeting = await this.getMeeting(code)
    if (!meeting) return null

    if (meeting.participants.length >= 6) {
      return null
    }

    const participantId = uuidv4()
    const participant: MeetingParticipant = {
      id: participantId,
      name: displayName.trim() || 'Guest',
      isHost: false,
      isMuted: false,
      isCameraOff: false,
      isScreenSharing: false,
    }
    meeting.participants.push(participant)
    await this.save(meeting)
    return { meeting: structuredClone(meeting), participantId }
  }

  /** Host creates via REST then sets display name when joining the socket lobby. */
  async setParticipantName(
    code: string,
    participantId: string,
    name: string,
  ): Promise<MeetingRecord | null> {
    const meeting = await this.getMeeting(code)
    if (!meeting) return null
    const participant = meeting.participants.find((p) => p.id === participantId)
    if (!participant) return null
    participant.name = name.trim() || participant.name
    await this.save(meeting)
    return structuredClone(meeting)
  }

  async bindSocket(
    code: string,
    participantId: string,
    socketId: string,
  ): Promise<MeetingRecord | null> {
    const meeting = await this.getMeeting(code)
    if (!meeting) return null
    const participant = meeting.participants.find((p) => p.id === participantId)
    if (!participant) return null
    participant.socketId = socketId
    await this.save(meeting)
    return structuredClone(meeting)
  }

  async updateParticipantMedia(
    code: string,
    participantId: string,
    patch: Partial<Pick<MeetingParticipant, 'isMuted' | 'isCameraOff' | 'isScreenSharing'>>,
  ): Promise<MeetingRecord | null> {
    const meeting = await this.getMeeting(code)
    if (!meeting) return null
    const participant = meeting.participants.find((p) => p.id === participantId)
    if (!participant) return null
    Object.assign(participant, patch)
    await this.save(meeting)
    return structuredClone(meeting)
  }

  async forceMute(
    code: string,
    hostParticipantId: string,
    targetParticipantId: string,
  ): Promise<MeetingRecord | null> {
    const meeting = await this.getMeeting(code)
    if (!meeting) return null
    if (meeting.hostParticipantId !== hostParticipantId) return null
    const target = meeting.participants.find((p) => p.id === targetParticipantId)
    if (!target || target.isHost) return null
    target.isMuted = true
    await this.save(meeting)
    return structuredClone(meeting)
  }

  async removeParticipant(
    code: string,
    participantId: string,
  ): Promise<{ meeting: MeetingRecord | null; removed: MeetingParticipant | null }> {
    const meeting = await this.getMeeting(code)
    if (!meeting) return { meeting: null, removed: null }

    const index = meeting.participants.findIndex((p) => p.id === participantId)
    if (index === -1) return { meeting: structuredClone(meeting), removed: null }

    const [removed] = meeting.participants.splice(index, 1)
    if (meeting.participants.length === 0) {
      await this.deleteMeeting(code)
      return { meeting: null, removed }
    }
    await this.save(meeting)
    return { meeting: structuredClone(meeting), removed }
  }

  async hostRemove(
    code: string,
    hostParticipantId: string,
    targetParticipantId: string,
  ): Promise<{ meeting: MeetingRecord | null; removed: MeetingParticipant | null } | null> {
    const meeting = await this.getMeeting(code)
    if (!meeting) return null
    if (meeting.hostParticipantId !== hostParticipantId) return null
    if (targetParticipantId === hostParticipantId) return null
    return this.removeParticipant(code, targetParticipantId)
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
