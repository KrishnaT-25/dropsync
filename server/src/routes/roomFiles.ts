import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { roomStore } from '../store/roomStore.js'
import { FileAccessError, roomFiles } from '../services/roomFiles.js'
import { checkRateLimit } from '../services/rateLimit.js'

export const roomFilesRouter = Router()

function fail(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof FileAccessError) { res.status(error.status).json({ error: error.message }); return }
  next(error)
}

async function member(req: Request, active: boolean) {
  const token = String(req.header('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const found = await roomStore.authorize(String(req.params.code), token, false)
  if (!found) throw new FileAccessError('Unauthorized', 401)
  if (active && found.room.status !== 'active') throw new FileAccessError('Room is read-only', 409)
  return { code: found.room.code, participantId: found.participantId }
}

const initiateSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().max(150).default('application/octet-stream'),
  size: z.number().int().positive(),
  fingerprint: z.string().max(128).optional(),
})

roomFilesRouter.post('/:code/files', async (req, res, next) => {
  try {
    const auth = await member(req, true)
    const parsed = initiateSchema.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: 'Invalid file details' }); return }
    const limit = await checkRateLimit(`upload-init:${auth.participantId}`, 20, 60 * 60_000)
    if (!limit.allowed) { res.status(429).json({ error: 'Too many uploads' }); return }
    res.status(201).json(await roomFiles.initiate(auth.code, auth.participantId, parsed.data))
  } catch (error) { fail(error, res, next) }
})

roomFilesRouter.post('/:code/files/:fileId/parts/:partNumber/url', async (req, res, next) => {
  try {
    const auth = await member(req, true)
    const limit = await checkRateLimit(`upload-part:${auth.participantId}`, 120, 60_000)
    if (!limit.allowed) { res.status(429).json({ error: 'Slow down a bit' }); return }
    res.json(await roomFiles.partUrl(auth.code, req.params.fileId, auth.participantId, Number(req.params.partNumber)))
  } catch (error) { fail(error, res, next) }
})

roomFilesRouter.get('/:code/files/:fileId/upload-status', async (req, res, next) => {
  try {
    const auth = await member(req, true)
    res.json(await roomFiles.uploadStatus(auth.code, req.params.fileId, auth.participantId))
  } catch (error) { fail(error, res, next) }
})

roomFilesRouter.post('/:code/files/:fileId/complete', async (req, res, next) => {
  try {
    const auth = await member(req, true)
    const file = await roomFiles.complete(auth.code, req.params.fileId, auth.participantId)
    res.json({ fileId: file?.fileId, status: file?.status })
  } catch (error) { fail(error, res, next) }
})

roomFilesRouter.post('/:code/files/:fileId/abort', async (req, res, next) => {
  try {
    const auth = await member(req, false)
    await roomFiles.abort(auth.code, req.params.fileId, auth.participantId)
    res.json({ status: 'aborted' })
  } catch (error) { fail(error, res, next) }
})

roomFilesRouter.get('/:code/files', async (req, res, next) => {
  try {
    const auth = await member(req, false)
    res.json({ files: await roomFiles.list(auth.code) })
  } catch (error) { fail(error, res, next) }
})

roomFilesRouter.get('/:code/files/:fileId/download-url', async (req, res, next) => {
  try {
    const auth = await member(req, false)
    res.json(await roomFiles.downloadUrl(auth.code, req.params.fileId))
  } catch (error) { fail(error, res, next) }
})
