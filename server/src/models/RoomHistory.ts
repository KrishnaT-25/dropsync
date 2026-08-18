import mongoose, { Schema } from 'mongoose'

export type RoomCloseReason = 'expired' | 'deleted'

export interface RoomHistoryDocument {
  code: string
  createdAt: Date
  expiresAt: Date
  finalParticipantCount: number
  finalActivityCount: number
  closedAt: Date
  reason: RoomCloseReason
}

const roomHistorySchema = new Schema<RoomHistoryDocument>(
  {
    code: { type: String, required: true, index: true },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    finalParticipantCount: { type: Number, required: true, min: 0 },
    finalActivityCount: { type: Number, required: true, min: 0 },
    closedAt: { type: Date, required: true, default: () => new Date() },
    reason: { type: String, required: true, enum: ['expired', 'deleted'] },
  },
  {
    collection: 'room_history',
    versionKey: false,
  },
)

export const RoomHistory = mongoose.model<RoomHistoryDocument>('RoomHistory', roomHistorySchema)
