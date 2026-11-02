import mongoose, { Schema } from 'mongoose'

export type RoomFileStatus = 'uploading' | 'ready' | 'failed'

export interface RoomFileDocument {
  fileId: string
  roomCode: string
  participantId: string
  objectKey: string
  uploadId?: string
  fileName: string
  mimeType: string
  size: number
  status: RoomFileStatus
  createdAt: Date
  completedAt?: Date
  fingerprint?: string
}

const schema = new Schema<RoomFileDocument>(
  {
    fileId: { type: String, required: true, unique: true },
    roomCode: { type: String, required: true, index: true },
    participantId: { type: String, required: true },
    objectKey: { type: String, required: true, unique: true },
    uploadId: String,
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    status: { type: String, required: true, index: true },
    createdAt: { type: Date, required: true },
    completedAt: Date,
    fingerprint: String,
  },
  { collection: 'room_files', versionKey: false },
)
schema.index({ roomCode: 1, status: 1 })

export const RoomFile =
  (mongoose.models.RoomFile as mongoose.Model<RoomFileDocument> | undefined) ??
  mongoose.model<RoomFileDocument>('RoomFile', schema)
