import mongoose, { Schema } from 'mongoose'

export interface StorageQuotaDocument {
  _id: string
  usedBytes: number
  reservedBytes: number
}

const schema = new Schema<StorageQuotaDocument>(
  {
    _id: { type: String, required: true },
    usedBytes: { type: Number, default: 0 },
    reservedBytes: { type: Number, default: 0 },
  },
  { collection: 'storage_quota', versionKey: false },
)

export const StorageQuota =
  (mongoose.models.StorageQuota as mongoose.Model<StorageQuotaDocument> | undefined) ??
  mongoose.model<StorageQuotaDocument>('StorageQuota', schema)
