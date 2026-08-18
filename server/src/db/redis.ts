import { Redis } from 'ioredis'
import { config } from '../config.js'

let redis: Redis | null = null
let redisPub: Redis | null = null
let redisSub: Redis | null = null

function createClient(label: string): Redis {
  const client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  })

  client.on('error', (err: Error) => {
    console.error(`[redis:${label}]`, err.message)
  })

  return client
}

export async function connectRedis(): Promise<{
  redis: Redis
  redisPub: Redis
  redisSub: Redis
}> {
  redis = createClient('main')
  redisPub = createClient('pub')
  redisSub = createClient('sub')

  await redis.ping()
  await redisPub.ping()
  await redisSub.ping()

  console.log('Connected to Redis')
  return { redis, redisPub, redisSub }
}

export function getRedis(): Redis {
  if (!redis) {
    throw new Error('Redis has not been connected yet')
  }
  return redis
}

export async function disconnectRedis(): Promise<void> {
  await Promise.all([
    redis?.quit(),
    redisPub?.quit(),
    redisSub?.quit(),
  ])
  redis = null
  redisPub = null
  redisSub = null
}
