import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setShuttingDown } from '../services/readiness.js'
import { startTestServer, stopTestServer, type TestHarness } from './helpers.js'

describe('health and readiness', () => {
  let h: TestHarness
  beforeAll(async () => { h = await startTestServer() })
  afterAll(async () => {
    setShuttingDown(false)
    await stopTestServer()
  })

  it('checks both dependencies and stops reporting readiness during shutdown', async () => {
    const ready = await h.agent.get('/ready')
    expect(ready.status).toBe(200)
    expect(ready.body.dependencies).toEqual({ mongo: true, redis: true })

    setShuttingDown(true)
    try {
      const unavailable = await h.agent.get('/ready')
      expect(unavailable.status).toBe(503)
      expect(unavailable.body.status).toBe('unavailable')
      expect((await h.agent.get('/health')).status).toBe(200)
    } finally {
      setShuttingDown(false)
    }
  })
})
