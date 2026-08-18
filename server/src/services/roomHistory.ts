import type { RoomRecord } from '../types.js'
import { RoomHistory, type RoomCloseReason } from '../models/RoomHistory.js'

export async function recordRoomHistory(
  room: RoomRecord,
  reason: RoomCloseReason,
): Promise<void> {
  try {
    await RoomHistory.create({
      code: room.code,
      createdAt: new Date(room.createdAt),
      expiresAt: new Date(room.expiresAt),
      finalParticipantCount: room.participants.length,
      finalActivityCount: room.activities.length,
      closedAt: new Date(),
      reason,
    })
  } catch (err) {
    console.error(`[room-history] failed to record ${room.code}:`, err)
  }
}
