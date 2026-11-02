import mongoose from 'mongoose'
import { getRedis } from '../db/redis.js'

let shuttingDown = false

export function setShuttingDown(value: boolean): void {
  shuttingDown = value
}

async function withinTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Dependency ping timed out')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function checkReadiness(): Promise<{
  ready: boolean
  mongo: boolean
  redis: boolean
}> {
  if (shuttingDown) return { ready: false, mongo: false, redis: false }

  const [mongo, redis] = await Promise.all([
    (async () => {
      if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false
      try {
        await withinTimeout(mongoose.connection.db.admin().ping(), 1000)
        return true
      } catch { return false }
    })(),
    (async () => {
      try {
        const client = getRedis()
        if (client.status !== 'ready') return false
        await withinTimeout(client.ping(), 1000)
        return true
      } catch { return false }
    })(),
  ])

  return { ready: mongo && redis, mongo, redis }
}
