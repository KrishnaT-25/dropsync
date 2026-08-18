import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
    })
    await emitAck(socketB, 'join-room', {
      code: b.body.room.code,
      participantId: b.body.participantId,
    })

    const leaked = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => resolve(), 400)
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

  it('does not leak meeting events into room channels', async () => {
    const room = await h.agent.post('/api/rooms').send({})
    const meeting = await h.agent.post('/api/meetings').send({})

    const roomSocket = connectClient(h.baseUrl)
    const meetSocket = connectClient(h.baseUrl)
    await Promise.all([waitConnected(roomSocket), waitConnected(meetSocket)])

    await emitAck(roomSocket, 'join-room', {
      code: room.body.room.code,
      participantId: room.body.participantId,
    })
    await emitAck(meetSocket, 'join-meeting', {
      code: meeting.body.meeting.code,
      participantId: meeting.body.participantId,
      displayName: 'Host',
    })

    const roomLeak = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => resolve(), 400)
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
      displayName: 'Host',
    })
    await emitAck(guestSocket, 'join-meeting', {
      code,
      participantId: guestId,
      displayName: 'Guest',
    })

    const forceMuted = new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 500)
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
})
