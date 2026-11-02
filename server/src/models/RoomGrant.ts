import mongoose, { Schema } from 'mongoose'

export interface RoomGrantDocument {
  roomCode: string
  participantId: string
  tokenHash: string
  createdAt: Date
}

const schema = new Schema<RoomGrantDocument>(
  {
    roomCode: { type: String, required: true, index: true },
    participantId: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'room_grants', versionKey: false },
)

export const RoomGrant =
  (mongoose.models.RoomGrant as mongoose.Model<RoomGrantDocument> | undefined) ??
  mongoose.model<RoomGrantDocument>('RoomGrant', schema)
