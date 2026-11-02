import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('ICE server configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns all configured TURN transports to WebRTC clients', async () => {
    vi.stubEnv(
      'TURN_URLS',
      'turn:relay.example.com:3478?transport=udp, turn:relay.example.com:3478?transport=tcp, turns:relay.example.com:5349?transport=tcp',
    )
    vi.stubEnv('TURN_USERNAME', 'test-user')
    vi.stubEnv('TURN_CREDENTIAL', 'test-password')
    vi.resetModules()

    const { createApp } = await import('../app.js')
    const response = await request(createApp()).get('/api/ice-servers')

    expect(response.status).toBe(200)
    expect(response.body.turnConfigured).toBe(true)
    expect(response.body.iceServers).toContainEqual({
      urls: [
        'turn:relay.example.com:3478?transport=udp',
        'turn:relay.example.com:3478?transport=tcp',
        'turns:relay.example.com:5349?transport=tcp',
      ],
      username: 'test-user',
      credential: 'test-password',
    })
  })
})
