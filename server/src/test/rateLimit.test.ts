import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { checkRateLimit, RATE_LIMITS } from '../services/rateLimit.js'
import {
  connectClient,
  flushRateLimitKeys,
  startTestServer,
  stopTestServer,
  waitConnected,
  type TestHarness,
} from './helpers.js'

describe('rate limiting', () => {
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

  it('triggers and resets fixed-window limits', async () => {
    const key = `test:${Date.now()}`
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimit(key, 3, 2000)
      expect(r.allowed).toBe(true)
    }
    const blocked = await checkRateLimit(key, 3, 2000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)

    await new Promise((r) => setTimeout(r, 2100))
    const after = await checkRateLimit(key, 3, 2000)
    expect(after.allowed).toBe(true)
  })

  it('rate-limits activity socket events with a clear ack', async () => {
    const created = await h.agent.post('/api/rooms').send({})
    const code = created.body.room.code as string
    const participantId = created.body.participantId as string

    const socket = connectClient(h.baseUrl)
    await waitConnected(socket)

    const joinAck = await new Promise<{ ok: boolean }>((resolve) => {
      socket.emit('join-room', { code, participantId }, resolve)
    })
    expect(joinAck.ok).toBe(true)

    const results: Array<{ ok: boolean; code?: string; error?: string }> = []
    for (let i = 0; i < RATE_LIMITS.activity.max + 3; i++) {
      const ack = await new Promise<{ ok: boolean; code?: string; error?: string }>((resolve) => {
        socket.emit('activity', { type: 'message', content: `msg-${i}` }, resolve)
      })
      results.push(ack)
    }

    const limited = results.filter((r) => r.code === 'rate_limited' || r.error === 'Slow down a bit')
    expect(limited.length).toBeGreaterThan(0)
    expect(results.slice(0, RATE_LIMITS.activity.max).every((r) => r.ok)).toBe(true)

    socket.disconnect()
  })

  it('rate-limits room creation by IP', async () => {
    const statuses: number[] = []
    for (let i = 0; i < RATE_LIMITS.createIp.max + 2; i++) {
      const res = await h.agent.post('/api/rooms').send({})
      statuses.push(res.status)
    }
    expect(statuses.filter((s) => s === 201).length).toBe(RATE_LIMITS.createIp.max)
    expect(statuses.some((s) => s === 429)).toBe(true)
  })
})
