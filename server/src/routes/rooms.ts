import { Router } from 'express'
import { z } from 'zod'
import { roomStore } from '../store/roomStore.js'
import { isValidRoomCode, normalizeRoomCode } from '../utils/roomCode.js'

export const roomsRouter = Router()

roomsRouter.post('/', (_req, res) => {
  const result = roomStore.createRoom()
  res.status(201).json(result)
})

roomsRouter.get('/:code', (req, res) => {
  const code = normalizeRoomCode(req.params.code)
  if (!isValidRoomCode(code)) {
    res.status(400).json({ error: 'Invalid room code' })
    return
  }

  const room = roomStore.getRoom(code)
  if (!room) {
    res.status(404).json({ error: 'Room not found or expired' })
    return
  }

  res.json({ room })
})

const joinSchema = z.object({
  displayName: z.string().trim().min(1).max(32).optional(),
})

roomsRouter.post('/:code/join', (req, res) => {
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

  const result = roomStore.joinRoom(code, parsed.data.displayName ?? 'Guest')
  if (!result) {
    res.status(404).json({ error: 'Room not found or expired' })
    return
  }

  res.json(result)
})
