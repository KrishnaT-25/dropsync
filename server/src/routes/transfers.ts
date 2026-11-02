import { Router } from 'express'
import { z } from 'zod'
import { getFallbackTransfer } from '../services/fallbackStorage.js'
import { getTransferStats, recordTransfer, type TransferPath } from '../services/transferStats.js'

export const transfersRouter = Router()

transfersRouter.get('/stats', (_req, res) => {
  res.json(getTransferStats())
})

const recordSchema = z.object({
  path: z.enum(['direct', 'relay', 'storage']),
})

transfersRouter.post('/stats', (req, res) => {
  const parsed = recordSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body' })
    return
  }
  recordTransfer(parsed.data.path as TransferPath)
  res.json(getTransferStats())
})

transfersRouter.get('/:transferId/download', async (req, res, next) => {
  try {
    const obj = await getFallbackTransfer(req.params.transferId)
    if (!obj) {
      res.status(404).json({ error: 'Transfer not found or expired' })
      return
    }

    res.setHeader('Content-Type', obj.mimeType)
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(obj.fileName)}`,
    )
    res.send(obj.buffer)
  } catch (err) {
    next(err)
  }
})
