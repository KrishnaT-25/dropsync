import mongoose, { Schema } from 'mongoose'

export type RoomStatus = 'active' | 'expired_recoverable' | 'deleting' | 'deleted'

export interface DurableRoomDocument {
  code: string
  name?: string
  createdAt: Date
  expiresAt: Date
  recoveryDeadline: Date
  durationMinutes: number
  status: RoomStatus
  passwordHash?: string
  recoveryHash: string
  participants: Array<{ id: string; name: string; socketId?: string }>
  storageBytes: number
  reservedBytes: number
  closedAt?: Date
  deletedAt?: Date
  cleanupAttempts: number
  cleanupError?: string
  cleanupLeaseUntil?: Date
}

const participantSchema = new Schema(
  { id: String, name: String, socketId: String },
  { _id: false },
)

const schema = new Schema<DurableRoomDocument>(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, default: 'Untitled room' },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    recoveryDeadline: { type: Date, required: true },
    durationMinutes: { type: Number, required: true },
    status: { type: String, required: true, index: true },
    passwordHash: String,
    recoveryHash: { type: String, required: true },
    participants: { type: [participantSchema], default: [] },
    storageBytes: { type: Number, default: 0 },
    reservedBytes: { type: Number, default: 0 },
    closedAt: Date,
    deletedAt: Date,
    cleanupAttempts: { type: Number, default: 0 },
    cleanupError: String,
    cleanupLeaseUntil: Date,
  },
  { collection: 'rooms', versionKey: false },
)
schema.index({ status: 1, recoveryDeadline: 1 })

export const DurableRoom =
  (mongoose.models.DurableRoom as mongoose.Model<DurableRoomDocument> | undefined) ??
  mongoose.model<DurableRoomDocument>('DurableRoom', schema)
