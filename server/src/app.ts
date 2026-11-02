import cors from 'cors'
import express from 'express'
import { config } from './config.js'
import { meetingsRouter } from './routes/meetings.js'
import { roomsRouter } from './routes/rooms.js'
import { roomFilesRouter } from './routes/roomFiles.js'
import { transfersRouter } from './routes/transfers.js'
import { getTransferStats } from './services/transferStats.js'
import { cleanupRooms } from './services/roomCleanup.js'

export function createApp() {
  const app = express()

  // Render / reverse proxies terminate TLS; needed for correct https download URLs.
  app.set('trust proxy', 1)

  app.use(
    cors({
      origin: config.clientOrigin,
    }),
  )

  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  app.get('/api/ice-servers', (_req, res) => {
    const iceServers: Array<{
      urls: string | string[]
      username?: string
      credential?: string
    }> = config.stunUrls.map((urls) => ({ urls }))

    if (config.turn) {
      iceServers.push({
        urls: config.turn.urls,
        username: config.turn.username,
        credential: config.turn.credential,
      })
    }

    res.set('Cache-Control', 'no-store').json({ iceServers, turnConfigured: Boolean(config.turn) })
  })

  app.get('/api/transfer-stats', (_req, res) => {
    res.json(getTransferStats())
  })

  app.post('/internal/cleanup', async (req, res, next) => {
    try {
      if (!config.cleanupSecret) { res.status(503).json({ error: 'Cleanup secret not configured' }); return }
      if (req.header('authorization') !== `Bearer ${config.cleanupSecret}`) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
      res.json(await cleanupRooms())
    } catch (error) { next(error) }
  })

  app.use('/api/rooms', roomFilesRouter)
  app.use('/api/rooms', roomsRouter)
  app.use('/api/meetings', meetingsRouter)
  app.use('/api/transfers', transfersRouter)

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error(err)
      res.status(500).json({ error: 'Internal server error' })
    },
  )

  return app
}
