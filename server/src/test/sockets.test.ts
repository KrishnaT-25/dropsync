import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { meetingStore } from '../store/meetingStore.js'
import {
  connectClient,
  flushRateLimitKeys,
  startTestServer,
  stopTestServer,
  waitConnected,
  type TestHarness,
} from './helpers.js'

function emitAck<T>(socket: ReturnType<typeof connectClient>, event: string, payload: unknown) {
  return new Promise<T>((resolve) => {
    socket.emit(event, payload, (ack: T) => resolve(ack))
  })
}

describe('socket isolation and host ACL', () => {
  let h: TestHarness

  beforeAll(async () => {
    h = await startTestServer()
  })

  afterAll(async () => {
    await stopTestServer()
  })

  beforeEach(async () => {
    await flushRateLimitKeys()
  })

  it('does not leak room activity across rooms', async () => {
    const a = await h.agent.post('/api/rooms').send({})
    const b = await h.agent.post('/api/rooms').send({})

    const socketA = connectClient(h.baseUrl)
    const socketB = connectClient(h.baseUrl)
    await Promise.all([waitConnected(socketA), waitConnected(socketB)])

    await emitAck(socketA, 'join-room', {
      code: a.body.room.code,
      participantId: a.body.participantId,
      accessToken: a.body.accessToken,
    })
    await emitAck(socketB, 'join-room', {
      code: b.body.room.code,
      participantId: b.body.participantId,
      accessToken: b.body.accessToken,
    })

    const leaked = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => resolve(), 1200)
      socketB.on('activity', () => {
        clearTimeout(t)
        reject(new Error('activity leaked into room B'))
      })
    })

    const seenInA = new Promise<void>((resolve) => {
      socketA.on('activity', (item: { content: string }) => {
        if (item.content === 'only-for-a') resolve()
      })
    })

    await emitAck(socketA, 'activity', { type: 'message', content: 'only-for-a' })
    await Promise.all([seenInA, leaked])

    socketA.disconnect()
    socketB.disconnect()
  })

  it('confirms a client message id and stores a retry only once', async () => {
    const created = await h.agent.post('/api/rooms').send({})
    const roomSocket = connectClient(h.baseUrl)
    await waitConnected(roomSocket)
    await emitAck(roomSocket, 'join-room', {
      code: created.body.room.code,
      participantId: created.body.participantId,
      accessToken: created.body.accessToken,
    })

    const id = randomUUID()
    const payload = { id, type: 'message', content: 'one quick message' }
    const first = await emitAck<{ ok: boolean; activity: { id: string } }>(roomSocket, 'activity', payload)
    const retry = await emitAck<{ ok: boolean; activity: { id: string } }>(roomSocket, 'activity', payload)
    const response = await h.agent.get(`/api/rooms/${created.body.room.code}`)
      .set('Authorization', `Bearer ${created.body.accessToken}`)

    expect(first.ok).toBe(true)
    expect(first.activity.id).toBe(id)
    expect(retry.activity.id).toBe(id)
    expect(response.body.room.activities.filter((item: { id: string }) => item.id === id)).toHaveLength(1)
    roomSocket.disconnect()
  })

  it('does not leak meeting events into room channels', async () => {
    const room = await h.agent.post('/api/rooms').send({})
    const meeting = await h.agent.post('/api/meetings').send({})

    const roomSocket = connectClient(h.baseUrl)
    const meetSocket = connectClient(h.baseUrl)
    await Promise.all([waitConnected(roomSocket), waitConnected(meetSocket)])

    await emitAck(roomSocket, 'join-room', {
      code: room.body.room.code,
      participantId: room.body.participantId,
      accessToken: room.body.accessToken,
    })
    await emitAck(meetSocket, 'join-meeting', {
      code: meeting.body.meeting.code,
      participantId: meeting.body.participantId,
      accessToken: meeting.body.accessToken,
      displayName: 'Host',
    })

    const roomLeak = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => resolve(), 1200)
      roomSocket.on('meeting-activity', () => {
        clearTimeout(t)
        reject(new Error('meeting-activity leaked into room socket'))
      })
      roomSocket.on('meeting-state', () => {
        clearTimeout(t)
        reject(new Error('meeting-state leaked into room socket'))
      })
    })

    const meetSeen = new Promise<void>((resolve) => {
      meetSocket.on('meeting-activity', (p: { content: string }) => {
        if (p.content === 'hello-meet') resolve()
      })
    })

    await emitAck(meetSocket, 'meeting-activity', { content: 'hello-meet' })
    await Promise.all([meetSeen, roomLeak])

    roomSocket.disconnect()
    meetSocket.disconnect()
  })

  it('rejects host-only actions from non-host', async () => {
    const created = await h.agent.post('/api/meetings').send({})
    const code = created.body.meeting.code as string
    const hostId = created.body.participantId as string

    const guestJoin = await h.agent
      .post(`/api/meetings/${code}/join`)
      .send({ displayName: 'Guest' })
    const guestId = guestJoin.body.participantId as string

    const hostSocket = connectClient(h.baseUrl)
    const guestSocket = connectClient(h.baseUrl)
    await Promise.all([waitConnected(hostSocket), waitConnected(guestSocket)])

    await emitAck(hostSocket, 'join-meeting', {
      code,
      participantId: hostId,
      accessToken: created.body.accessToken,
      displayName: 'Host',
    })
    await emitAck(guestSocket, 'join-meeting', {
      code,
      participantId: guestId,
      accessToken: guestJoin.body.accessToken,
      displayName: 'Guest',
    })

    const forceMuted = new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 1500)
      hostSocket.on('force-muted', () => {
        clearTimeout(t)
        resolve(true)
      })
      guestSocket.on('force-muted', () => {
        clearTimeout(t)
        resolve(true)
      })
    })

    guestSocket.emit('host-mute', { targetParticipantId: hostId })
    guestSocket.emit('host-end')

    const wasForced = await forceMuted
    expect(wasForced).toBe(false)

    // Meeting should still exist for host
    const still = await h.agent.get(`/api/meetings/${code}`)
    expect(still.status).toBe(200)

    hostSocket.disconnect()
    guestSocket.disconnect()
  })

  it('authenticates moderators and lets a co-host admit waiting guests', async () => {
    const created = await h.agent.post('/api/meetings').send({})
    const code = created.body.meeting.code as string
    expect(created.body.meeting.permissions.requireAdmission).toBe(true)
    await meetingStore.setPermissions(code, created.body.participantId, { requireAdmission: false })
    const first = await h.agent.post(`/api/meetings/${code}/join`).send({ displayName: 'First guest' })
    const host = connectClient(h.baseUrl)
    const coHost = connectClient(h.baseUrl)
    const impostor = connectClient(h.baseUrl)
    await Promise.all([waitConnected(host), waitConnected(coHost), waitConnected(impostor)])

    const stolenId = await emitAck<{ ok: boolean }>(impostor, 'join-meeting', {
      code, participantId: created.body.participantId, accessToken: first.body.accessToken, displayName: 'Impostor',
    })
    expect(stolenId.ok).toBe(false)
    expect((await emitAck<{ ok: boolean }>(host, 'join-meeting', {
      code, participantId: created.body.participantId, accessToken: created.body.accessToken, displayName: 'Host',
    })).ok).toBe(true)
    expect((await emitAck<{ ok: boolean }>(coHost, 'join-meeting', {
      code, participantId: first.body.participantId, accessToken: first.body.accessToken, displayName: 'First guest',
    })).ok).toBe(true)

    expect((await emitAck<{ ok: boolean }>(coHost, 'meeting-permissions', { requireAdmission: true })).ok).toBe(false)
    expect((await emitAck<{ ok: boolean }>(host, 'meeting-permissions', { requireAdmission: true })).ok).toBe(true)
    const waitingList = new Promise<Array<{ id: string }>>((resolve) => host.once('meeting-waiting', resolve))
    const second = await h.agent.post(`/api/meetings/${code}/join`).send({ displayName: 'Waiting guest' })
    expect((await waitingList).map((person) => person.id)).toContain(second.body.participantId)
    const waiting = connectClient(h.baseUrl)
    await waitConnected(waiting)
    const pendingAck = await emitAck<{ ok: boolean; waiting: boolean }>(waiting, 'join-meeting', {
      code, participantId: second.body.participantId, accessToken: second.body.accessToken, displayName: 'Waiting guest',
    })
    expect(pendingAck).toMatchObject({ ok: true, waiting: true })
    expect((await emitAck<{ ok: boolean }>(waiting, 'meeting-activity', { content: 'not admitted' })).ok).toBe(false)
    expect((await emitAck<{ ok: boolean }>(coHost, 'meeting-admit', {
      targetParticipantId: second.body.participantId,
    })).ok).toBe(false)
    expect((await emitAck<{ ok: boolean }>(coHost, 'meeting-cohost', {
      targetParticipantId: first.body.participantId, enabled: true,
    })).ok).toBe(false)
    const publicMeeting = await h.agent.get(`/api/meetings/${code}`)
    expect(publicMeeting.body.meeting.participants.map((person: { id: string }) => person.id)).not.toContain(second.body.participantId)
    expect(JSON.stringify(publicMeeting.body)).not.toContain('accessTokenHash')

    expect((await emitAck<{ ok: boolean }>(host, 'meeting-cohost', {
      targetParticipantId: first.body.participantId, enabled: true,
    })).ok).toBe(true)
    const admitted = new Promise<void>((resolve) => waiting.once('meeting-admitted', resolve))
    expect((await emitAck<{ ok: boolean }>(coHost, 'meeting-admit', {
      targetParticipantId: second.body.participantId,
    })).ok).toBe(true)
    await admitted
    expect((await emitAck<{ ok: boolean }>(waiting, 'join-meeting', {
      code, participantId: second.body.participantId, accessToken: second.body.accessToken, displayName: 'Waiting guest',
    })).ok).toBe(true)
    expect((await meetingStore.getMeeting(code))?.participants.find((person) => person.id === first.body.participantId)?.isCoHost).toBe(true)

    host.disconnect()
    coHost.disconnect()
    waiting.disconnect()
    impostor.disconnect()
  })
})
