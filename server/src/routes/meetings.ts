import { Router } from 'express'
import { z } from 'zod'
import {
  RATE_LIMITS,
  checkRateLimit,
  clientIpFromRequest,
} from '../services/rateLimit.js'
import { meetingStore, toPublicMeeting } from '../store/meetingStore.js'
import { isValidRoomCode, normalizeRoomCode } from '../utils/roomCode.js'

export const meetingsRouter = Router()

meetingsRouter.post('/', async (req, res, next) => {
  try {
    const ip = clientIpFromRequest(req)
    const createLimit = await checkRateLimit(
      `create-meeting:${ip}`,
      RATE_LIMITS.createIp.max,
      RATE_LIMITS.createIp.windowMs,
    )
    if (!createLimit.allowed) {
      res.status(429).json({ error: 'Slow down a bit', code: 'rate_limited' })
      return
    }

    const result = await meetingStore.createMeeting()
    res.status(201).json({
      meeting: toPublicMeeting(result.meeting),
      participantId: result.participantId,
    })
  } catch (err) {
    next(err)
  }
})

meetingsRouter.get('/:code', async (req, res, next) => {
  try {
    const code = normalizeRoomCode(req.params.code)
    if (!isValidRoomCode(code)) {
      res.status(400).json({ error: 'Invalid meeting code' })
      return
    }

    const meeting = await meetingStore.getMeeting(code)
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found or ended' })
      return
    }

    res.json({ meeting: toPublicMeeting(meeting) })
  } catch (err) {
    next(err)
  }
})

const joinSchema = z.object({
  displayName: z.string().trim().min(1).max(32),
})

meetingsRouter.post('/:code/join', async (req, res, next) => {
  try {
    const ip = clientIpFromRequest(req)
    const joinLimit = await checkRateLimit(
      `join-meeting-http:${ip}`,
      RATE_LIMITS.joinIp.max,
      RATE_LIMITS.joinIp.windowMs,
    )
    if (!joinLimit.allowed) {
      res.status(429).json({ error: 'Slow down a bit', code: 'rate_limited' })
      return
    }

    const code = normalizeRoomCode(req.params.code)
    if (!isValidRoomCode(code)) {
      res.status(400).json({ error: 'Invalid meeting code' })
      return
    }

    const parsed = joinSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Display name is required' })
      return
    }

    const existing = await meetingStore.getMeeting(code)
    if (!existing) {
      res.status(404).json({ error: 'Meeting not found or ended' })
      return
    }
    if (existing.participants.length >= 6) {
      res.status(403).json({ error: 'This meeting supports at most 6 participants.' })
      return
    }

    const result = await meetingStore.joinMeeting(code, parsed.data.displayName)
    if (!result) {
      res.status(404).json({ error: 'Meeting not found or ended' })
      return
    }

    res.json({
      meeting: toPublicMeeting(result.meeting),
      participantId: result.participantId,
    })
  } catch (err) {
    next(err)
  }
})
