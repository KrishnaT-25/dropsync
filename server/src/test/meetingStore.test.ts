import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { meetingStore } from '../store/meetingStore.js'
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
    const guests = await Promise.all(
      Array.from({ length: 3 }, (_, i) => meetingStore.joinMeeting(meeting.code, `Guest ${i}`)),
    )
    const [first, second, third] = guests.map((guest) => guest!.participantId)

    await Promise.all([
      meetingStore.setParticipantName(meeting.code, first!, 'Renamed'),
      meetingStore.bindSocket(meeting.code, first!, 'socket-1'),
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
})
