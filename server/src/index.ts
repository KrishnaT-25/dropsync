import { createServer } from 'node:http'
import { createApp } from './app.js'
import { config } from './config.js'
import { createSocketServer } from './socket/index.js'

const app = createApp()
const httpServer = createServer(app)

createSocketServer(httpServer)

httpServer.listen(config.port, () => {
  console.log(`DropSync server listening on http://localhost:${config.port}`)
})
