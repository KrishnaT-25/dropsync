import { Router } from 'express'
import { z } from 'zod'
import { meetingStore, toPublicMeeting } from '../store/meetingStore.js'
import { isValidRoomCode, normalizeRoomCode } from '../utils/roomCode.js'

export const meetingsRouter = Router()

meetingsRouter.post('/', async (_req, res, next) => {
  try {
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
