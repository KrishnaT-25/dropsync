import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { meetingStore, toPublicMeeting, waitingParticipants } from '../store/meetingStore.js'
import { startTestServer, stopTestServer } from './helpers.js'

describe('atomic meeting updates', () => {
  beforeAll(async () => { await startTestServer() })
  afterAll(async () => { await stopTestServer() })

  it('keeps every accepted concurrent join and enforces the six-person limit', async () => {
    const { meeting, participantId: hostId } = await meetingStore.createMeeting()
    const attempts = await Promise.all(
      Array.from({ length: 12 }, (_, i) => meetingStore.joinMeeting(meeting.code, `Guest ${i}`)),
    )
    const accepted = attempts.filter((result) => result !== null)
    expect(accepted).toHaveLength(5)
    const latest = await meetingStore.getMeeting(meeting.code)
    expect(latest?.participants).toHaveLength(6)
    expect(new Set(latest?.participants.map((person) => person.id)).size).toBe(6)
    expect(latest?.participants.map((person) => person.id)).toContain(hostId)
    for (const result of accepted) {
      expect(latest?.participants.map((person) => person.id)).toContain(result!.participantId)
    }
  })

  it('preserves concurrent edits to different fields and removals', async () => {
    const { meeting } = await meetingStore.createMeeting()
    await meetingStore.setPermissions(meeting.code, meeting.hostParticipantId, { requireAdmission: false })
    const guests = await Promise.all(
      Array.from({ length: 3 }, (_, i) => meetingStore.joinMeeting(meeting.code, `Guest ${i}`)),
    )
    const [first, second, third] = guests.map((guest) => guest!.participantId)

    await Promise.all([
      meetingStore.bindSocket(meeting.code, first!, guests[0]!.accessToken, 'socket-1', 'Renamed'),
      meetingStore.updateParticipantMedia(meeting.code, first!, { isMuted: true }),
      meetingStore.updateParticipantMedia(meeting.code, first!, { isCameraOff: true }),
      meetingStore.updateParticipantMedia(meeting.code, second!, { isScreenSharing: true }),
    ])

    const edited = await meetingStore.getMeeting(meeting.code)
    expect(edited?.participants.find((person) => person.id === first)).toMatchObject({
      name: 'Renamed', socketId: 'socket-1', isMuted: true, isCameraOff: true,
    })
    expect(edited?.participants.find((person) => person.id === second)?.isScreenSharing).toBe(true)

    await Promise.all([
      meetingStore.removeParticipant(meeting.code, second!),
      meetingStore.hostRemove(meeting.code, meeting.hostParticipantId, third!),
    ])
    const remaining = await meetingStore.getMeeting(meeting.code)
    expect(remaining?.participants.map((person) => person.id).sort()).toEqual(
      [meeting.hostParticipantId, first].sort(),
    )
  })

  it('keeps tokens private and enforces admission, permissions, and co-host roles', async () => {
    const host = await meetingStore.createMeeting()
    const code = host.meeting.code
    await meetingStore.setPermissions(code, host.participantId, { requireAdmission: false })
    const moderator = await meetingStore.joinMeeting(code, 'Moderator')
    expect(moderator).not.toBeNull()
    expect(await meetingStore.bindSocket(code, host.participantId, moderator!.accessToken, 'impostor', 'Host')).toBeNull()
    expect(await meetingStore.bindSocket(code, host.participantId, host.accessToken, 'host-socket', 'Host')).not.toBeNull()
    expect(await meetingStore.setCoHost(code, moderator!.participantId, host.participantId, true)).toBeNull()
    expect(await meetingStore.setCoHost(code, host.participantId, moderator!.participantId, true)).not.toBeNull()
    expect(await meetingStore.setPermissions(code, moderator!.participantId, { requireAdmission: true })).toBeNull()
    expect(await meetingStore.setPermissions(code, host.participantId, {
      requireAdmission: true, allowScreenShare: false, allowParticipantUnmute: false,
    })).not.toBeNull()

    const guest = await meetingStore.joinMeeting(code, 'Waiting guest')
    expect(guest).not.toBeNull()
    expect(waitingParticipants(guest!.meeting).map((person) => person.id)).toContain(guest!.participantId)
    expect(toPublicMeeting(guest!.meeting).participants.map((person) => person.id)).not.toContain(guest!.participantId)
    expect(JSON.stringify(toPublicMeeting(guest!.meeting))).not.toContain('accessTokenHash')
    expect(await meetingStore.updateParticipantMedia(code, guest!.participantId, { isScreenSharing: true })).toBeNull()
    expect(await meetingStore.admitParticipant(code, guest!.participantId, guest!.participantId)).toBeNull()
    expect(await meetingStore.admitParticipant(code, moderator!.participantId, guest!.participantId)).not.toBeNull()
    expect(await meetingStore.updateParticipantMedia(code, guest!.participantId, { isScreenSharing: true })).toBeNull()
    expect(await meetingStore.updateParticipantMedia(code, guest!.participantId, { isMuted: false })).toBeNull()
    expect(await meetingStore.forceMute(code, moderator!.participantId, guest!.participantId)).not.toBeNull()
    expect(await meetingStore.hostRemove(code, guest!.participantId, moderator!.participantId)).toBeNull()
    expect(await meetingStore.setCoHost(code, host.participantId, moderator!.participantId, false)).not.toBeNull()
    expect(await meetingStore.forceMute(code, moderator!.participantId, guest!.participantId)).toBeNull()
  })
})
