import { Router } from 'express'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import {
  RATE_LIMITS,
  checkRateLimit,
  clientIpFromRequest,
} from '../services/rateLimit.js'
import { roomStore } from '../store/roomStore.js'
import { toPublicRoom } from '../utils/publicRoom.js'
import { isValidRoomCode, normalizeRoomCode } from '../utils/roomCode.js'
import { config } from '../config.js'

export const roomsRouter = Router()

const BCRYPT_ROUNDS = 10

const createSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  password: z.string().max(64).optional(),
  durationMinutes: z.number().int().min(config.minRoomMinutes).max(config.maxRoomMinutes).default(5),
})

roomsRouter.post('/', async (req, res, next) => {
  try {
    const ip = clientIpFromRequest(req)
    const createLimit = await checkRateLimit(
      `create-room:${ip}`,
      RATE_LIMITS.createIp.max,
      RATE_LIMITS.createIp.windowMs,
    )
    if (!createLimit.allowed) {
      res.status(429).json({ error: 'Slow down a bit', code: 'rate_limited' })
      return
    }

    const parsed = createSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body' })
      return
    }

    const rawPassword = parsed.data.password?.trim() ?? ''
    if (rawPassword.length > 0 && rawPassword.length < 4) {
      res.status(400).json({ error: 'Password must be at least 4 characters' })
      return
    }

    const passwordHash =
      rawPassword.length > 0 ? await bcrypt.hash(rawPassword, BCRYPT_ROUNDS) : undefined

    const result = await roomStore.createRoom(passwordHash, parsed.data.durationMinutes, parsed.data.name)
    res.status(201).json({
      room: toPublicRoom(result.room),
      participantId: result.participantId,
      accessToken: result.accessToken,
      recoveryKey: result.recoveryKey,
    })
  } catch (err) {
    next(err)
  }
})

roomsRouter.get('/:code', async (req, res, next) => {
  try {
    const code = normalizeRoomCode(req.params.code)
    if (!isValidRoomCode(code)) {
      res.status(400).json({ error: 'Invalid room code' })
      return
    }

    const token = String(req.header('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const authorized = await roomStore.authorize(code, token)
    if (!authorized) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    res.json({ room: toPublicRoom(authorized.room) })
  } catch (err) {
    next(err)
  }
})

roomsRouter.get('/:code/preview', async (req, res, next) => {
  try {
    const preview = await roomStore.preview(req.params.code)
    if (!preview) {
      res.status(404).json({ error: 'Room not found' })
      return
    }
    res.json(preview)
  } catch (err) { next(err) }
})

const joinSchema = z.object({
  displayName: z.string().trim().min(1).max(32).optional(),
  password: z.string().max(64).optional(),
})

roomsRouter.post('/:code/join', async (req, res, next) => {
  try {
    const ip = clientIpFromRequest(req)
    const joinLimit = await checkRateLimit(
      `join-room-http:${ip}`,
      RATE_LIMITS.joinIp.max,
      RATE_LIMITS.joinIp.windowMs,
    )
    if (!joinLimit.allowed) {
      res.status(429).json({ error: 'Slow down a bit', code: 'rate_limited' })
      return
    }

    const code = normalizeRoomCode(req.params.code)
    if (!isValidRoomCode(code)) {
      res.status(400).json({ error: 'Invalid room code' })
      return
    }

    const parsed = joinSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body' })
      return
    }

    const room = await roomStore.getRoom(code)
    if (!room) {
      res.status(404).json({ error: 'Room not found or expired' })
      return
    }

    if (room.passwordHash) {
      const provided = parsed.data.password
      if (provided === undefined || provided === '') {
        res.status(401).json({ error: 'password_required' })
        return
      }

      const match = await bcrypt.compare(provided, room.passwordHash)
      if (!match) {
        res.status(401).json({ error: 'incorrect_password' })
        return
      }
    }

    const result = await roomStore.joinRoom(code, parsed.data.displayName ?? 'Guest')
    if (!result) {
      res.status(404).json({ error: 'Room not found or expired' })
      return
    }

    res.json({
      room: toPublicRoom(result.room),
      participantId: result.participantId,
      accessToken: result.accessToken,
    })
  } catch (err) {
    next(err)
  }
})

const recoverySchema = z.object({ recoveryKey: z.string().min(20).max(256) })

roomsRouter.post('/:code/reopen', async (req, res, next) => {
  try {
    const parsed = recoverySchema.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: 'Recovery key required' }); return }
    const result = await roomStore.reopen(req.params.code, parsed.data.recoveryKey)
    if (!result) { res.status(403).json({ error: 'Recovery is unavailable' }); return }
    res.json({ room: toPublicRoom(result.room), participantId: result.participantId, accessToken: result.accessToken })
  } catch (err) { next(err) }
})

roomsRouter.delete('/:code', async (req, res, next) => {
  try {
    const parsed = recoverySchema.safeParse(req.body)
    if (!parsed.success || !(await roomStore.verifyRecoveryKey(req.params.code, parsed.data.recoveryKey))) {
      res.status(403).json({ error: 'Invalid recovery key' })
      return
    }
    await roomStore.deleteRoom(req.params.code)
    res.status(202).json({ status: 'deleting' })
  } catch (err) { next(err) }
})
