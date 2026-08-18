import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  flushRateLimitKeys,
  getRedis,
  startTestServer,
  stopTestServer,
  type TestHarness,
} from './helpers.js'

describe('rooms HTTP API', () => {
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

  it('creates a room without password', async () => {
    const res = await h.agent.post('/api/rooms').send({})
    expect(res.status).toBe(201)
    expect(res.body.room.code).toMatch(/^[A-Z0-9]{6}$/)
    expect(res.body.participantId).toBeTruthy()
    expect(res.body.room.hasPassword).toBe(false)
  })

  it('creates a password-protected room and enforces join', async () => {
    const created = await h.agent.post('/api/rooms').send({ password: 'secret1' })
    expect(created.status).toBe(201)
    const code = created.body.room.code as string
    expect(created.body.room.hasPassword).toBe(true)

    const missing = await h.agent.post(`/api/rooms/${code}/join`).send({ displayName: 'A' })
    expect(missing.status).toBe(401)
    expect(missing.body.error).toBe('password_required')

    const wrong = await h.agent
      .post(`/api/rooms/${code}/join`)
      .send({ displayName: 'A', password: 'nope' })
    expect(wrong.status).toBe(401)
    expect(wrong.body.error).toBe('incorrect_password')

    const ok = await h.agent
      .post(`/api/rooms/${code}/join`)
      .send({ displayName: 'A', password: 'secret1' })
    expect(ok.status).toBe(200)
    expect(ok.body.participantId).toBeTruthy()
  })

  it('sets Redis TTL on room data keys', async () => {
    const created = await h.agent.post('/api/rooms').send({})
    const code = created.body.room.code as string
    const ttl = await getRedis().ttl(`room:data:${code}`)
    expect(ttl).toBeGreaterThan(60)
    expect(ttl).toBeLessThanOrEqual(360)
  })
})
