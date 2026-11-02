import mongoose, { Schema } from 'mongoose'
import type { ActivityItem } from '../types.js'

export interface RoomActivityDocument extends ActivityItem {
  roomCode: string
}

const schema = new Schema<RoomActivityDocument>(
  {
    roomCode: { type: String, required: true, index: true },
    id: { type: String, required: true },
    type: { type: String, required: true },
    content: { type: String, required: true },
    sender: String,
    senderId: String,
    timestamp: { type: String, required: true },
    fileMeta: Schema.Types.Mixed,
  },
  { collection: 'room_activities', versionKey: false },
)
schema.index({ roomCode: 1, timestamp: 1 })

export const RoomActivity =
  (mongoose.models.RoomActivity as mongoose.Model<RoomActivityDocument> | undefined) ??
  mongoose.model<RoomActivityDocument>('RoomActivity', schema)
