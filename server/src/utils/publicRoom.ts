import type { RoomRecord } from '../types.js'

export type PublicRoomRecord = Omit<RoomRecord, 'passwordHash'> & {
  hasPassword: boolean
}

/** Strip secrets before sending room state to clients. */
export function toPublicRoom(room: RoomRecord): PublicRoomRecord {
  const { passwordHash, ...rest } = room
  return {
    ...rest,
    hasPassword: Boolean(passwordHash),
  }
}
