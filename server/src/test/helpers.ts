import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import request from 'supertest'
import { createApp } from '../app.js'
import { connectRedis, disconnectRedis, getRedis } from '../db/redis.js'
import { createSocketServer } from '../socket/index.js'
import type { Server } from 'socket.io'

export interface TestHarness {
  httpServer: HttpServer
  io: Server
  baseUrl: string
  agent: ReturnType<typeof request>
}

let harness: TestHarness | null = null
let refCount = 0

export async function startTestServer(): Promise<TestHarness> {
  refCount += 1
  if (harness) return harness

  const { redisPub, redisSub } = await connectRedis()
  const app = createApp()
  const httpServer = createServer(app)
  const io = createSocketServer(httpServer, { redisPub, redisSub })

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve())
  })

  const { port } = httpServer.address() as AddressInfo
  harness = {
    httpServer,
    io,
    baseUrl: `http://127.0.0.1:${port}`,
    agent: request(app),
  }
  return harness
}

export async function stopTestServer(): Promise<void> {
  refCount = Math.max(0, refCount - 1)
  if (refCount > 0 || !harness) return
  const current = harness
  harness = null
  await new Promise<void>((resolve) => {
    current.io.close(() => resolve())
  })
  if (current.httpServer.listening) {
    await new Promise<void>((resolve, reject) => {
      current.httpServer.close((err) => (err ? reject(err) : resolve()))
    })
  }
  await disconnectRedis()
}

export function connectClient(baseUrl: string): ClientSocket {
  return ioClient(baseUrl, {
    transports: ['websocket'],
    forceNew: true,
    autoConnect: true,
  })
}

export async function waitConnected(socket: ClientSocket): Promise<void> {
  if (socket.connected) return
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('socket connect timeout')), 10_000)
    socket.once('connect', () => {
      clearTimeout(t)
      resolve()
    })
    socket.once('connect_error', (err) => {
      clearTimeout(t)
      reject(err)
    })
  })
}

export async function flushRateLimitKeys(): Promise<void> {
  const redis = getRedis()
  const keys = await redis.keys('rl:*')
  if (keys.length) await redis.del(...keys)
}

export { getRedis }
