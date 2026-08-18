import { createServer } from 'node:http'
import { createApp } from './app.js'
import { config } from './config.js'
import { connectMongo } from './db/mongo.js'
import { connectRedis } from './db/redis.js'
import { createSocketServer } from './socket/index.js'

async function main() {
  await connectMongo()
  const { redisPub, redisSub } = await connectRedis()

  const app = createApp()
  const httpServer = createServer(app)

  createSocketServer(httpServer, { redisPub, redisSub })

  httpServer.listen(config.port, () => {
    console.log(`DropSync server listening on http://localhost:${config.port}`)
  })
}

main().catch((err) => {
  console.error('Failed to start DropSync server:', err)
  process.exit(1)
})
