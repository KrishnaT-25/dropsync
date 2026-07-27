import cors from 'cors'
import express from 'express'
import { config } from './config.js'
import { roomsRouter } from './routes/rooms.js'

export function createApp() {
  const app = express()

  app.use(
    cors({
      origin: config.clientOrigin,
    }),
  )
  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  app.use('/api/rooms', roomsRouter)

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  return app
}
