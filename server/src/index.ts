import { createServer } from 'node:http'
import { createApp } from './app.js'
import { config } from './config.js'
import { connectMongo, disconnectMongo } from './db/mongo.js'
import { connectRedis, disconnectRedis } from './db/redis.js'
import { setShuttingDown } from './services/readiness.js'
import { createSocketServer } from './socket/index.js'
import { waitForSocketCleanups } from './socket/cleanupTasks.js'
import { roomStore } from './store/roomStore.js'

async function main() {
  await connectMongo()
  const { redisPub, redisSub } = await connectRedis()

  const app = createApp()
  const httpServer = createServer(app)

  const io = createSocketServer(httpServer, { redisPub, redisSub })

  let closing = false
  async function shutdown(signal: string): Promise<void> {
    if (closing) return
    closing = true
    setShuttingDown(true)
    console.log(`Received ${signal}; closing DropSync server`)
    const deadline = setTimeout(() => {
      console.error('Shutdown timed out')
      process.exit(1)
    }, 15_000)
    deadline.unref()

    try {
      roomStore.stopExpiryPoller()
      await new Promise<void>((resolve) => io.close(() => resolve()))
      await waitForSocketCleanups()
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => error ? reject(error) : resolve())
        })
      }
    } catch (error) {
      console.error('Shutdown failed:', error)
      process.exitCode = 1
    } finally {
      const settled = await Promise.allSettled([disconnectRedis(), disconnectMongo()])
      for (const result of settled) {
        if (result.status === 'rejected') {
          console.error('Dependency shutdown failed:', result.reason)
          process.exitCode = 1
        }
      }
      clearTimeout(deadline)
      console.log('DropSync server closed')
    }
  }

  process.once('SIGTERM', () => { void shutdown('SIGTERM') })
  process.once('SIGINT', () => { void shutdown('SIGINT') })

  httpServer.listen(config.port, () => {
    console.log(`DropSync server listening on http://localhost:${config.port}`)
  })
}

main().catch((err) => {
  console.error('Failed to start DropSync server:', err)
  process.exit(1)
})
