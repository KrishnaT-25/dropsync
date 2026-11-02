import mongoose from 'mongoose'
import { config } from '../config.js'
import { StorageQuota } from '../models/StorageQuota.js'

export async function connectMongo(): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true)
  await mongoose.connect(config.mongodbUri)
  await StorageQuota.updateOne(
    { _id: 'global' },
    { $setOnInsert: { usedBytes: 0, reservedBytes: 0 } },
    { upsert: true },
  )
  console.log('Connected to MongoDB')
  return mongoose
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect()
}
