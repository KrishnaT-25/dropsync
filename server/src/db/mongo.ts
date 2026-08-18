import mongoose from 'mongoose'
import { config } from '../config.js'

export async function connectMongo(): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true)
  await mongoose.connect(config.mongodbUri)
  console.log('Connected to MongoDB')
  return mongoose
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect()
}
