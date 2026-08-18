import { Router } from 'express'
import { z } from 'zod'
import { getMemoryTransfer, storeFallbackFile } from '../services/fallbackStorage.js'
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

transfersRouter.post('/upload', async (req, res, next) => {
  try {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? [])
    if (!buffer.length) {
      res.status(400).json({ error: 'Empty body' })
      return
    }
    if (buffer.length > 32 * 1024 * 1024) {
      res.status(413).json({ error: 'File too large (max 32MB for fallback upload)' })
      return
    }

    const fileName = String(req.header('x-file-name') ?? 'file.bin')
    const mimeType = String(req.header('x-mime-type') ?? 'application/octet-stream')

    const stored = await storeFallbackFile({ buffer, fileName, mimeType })
    recordTransfer('storage')

    const forwardedProto = String(req.get('x-forwarded-proto') ?? '')
      .split(',')[0]
      ?.trim()
    const protocol = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : req.protocol
    const downloadUrl = stored.downloadUrl.startsWith('http')
      ? stored.downloadUrl
      : `${protocol}://${req.get('host')}${stored.downloadUrl}`

    res.status(201).json({
      transferId: stored.transferId,
      downloadUrl,
      path: stored.path,
    })
  } catch (err) {
    next(err)
  }
})

transfersRouter.get('/:transferId/download', (req, res) => {
  const obj = getMemoryTransfer(req.params.transferId)
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
})
