import mongoose from 'mongoose'
import { DurableRoom } from '../models/DurableRoom.js'
import { RoomActivity } from '../models/RoomActivity.js'
import { RoomFile } from '../models/RoomFile.js'
import { RoomGrant } from '../models/RoomGrant.js'
import { StorageQuota } from '../models/StorageQuota.js'
import { objectStorage } from './objectStorage.js'

function missingUpload(error: unknown): boolean {
  const name = (error as { name?: string }).name
  return name === 'NoSuchUpload' || name === 'NotFound'
}

export async function cleanupRooms(): Promise<{ deleted: number; failed: number; abandonedUploads: number }> {
  const now = new Date()
  await DurableRoom.updateMany(
    { status: 'active', expiresAt: { $lte: now } },
    { $set: { status: 'expired_recoverable', closedAt: now } },
  )
  await DurableRoom.updateMany(
    { status: 'expired_recoverable', recoveryDeadline: { $lte: now } },
    { $set: { status: 'deleting', closedAt: now } },
  )

  let abandonedUploads = 0
  const stale = await RoomFile.find({ status: 'uploading' }).sort({ createdAt: 1 }).limit(100)
  for (const file of stale) {
    const room = await DurableRoom.findOne({ code: file.roomCode })
    if (room?.status === 'deleting' || room?.status === 'deleted') continue
    if (room?.status === 'active' && file.createdAt.getTime() > Date.now() - 2 * 3_600_000) continue
    try {
      if (file.uploadId) {
        try { await objectStorage.abort(file.objectKey, file.uploadId) }
        catch (error) { if (!missingUpload(error)) throw error }
      }
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => {
          const removed = await RoomFile.findOneAndDelete({ fileId: file.fileId, status: 'uploading' }, { session })
          if (!removed) return
          await DurableRoom.updateOne({ code: file.roomCode }, { $inc: { reservedBytes: -file.size } }, { session })
          await StorageQuota.updateOne({ _id: 'global' }, { $inc: { reservedBytes: -file.size } }, { session })
          abandonedUploads += 1
        })
      } finally { await session.endSession() }
    } catch (error) { console.error('[cleanup] stale upload', file.fileId, error) }
  }

  let deleted = 0
  let failed = 0
  const due = await DurableRoom.find({ status: 'deleting' }).limit(100)
  for (const candidate of due) {
    const claimed = await DurableRoom.findOneAndUpdate(
      { code: candidate.code, status: 'deleting',
        $or: [{ cleanupLeaseUntil: { $exists: false } }, { cleanupLeaseUntil: { $lte: new Date() } }] },
      { $set: { cleanupLeaseUntil: new Date(Date.now() + 10 * 60_000) }, $inc: { cleanupAttempts: 1 } },
      { returnDocument: 'after' },
    )
    if (!claimed) continue
    try {
      const files = await RoomFile.find({ roomCode: claimed.code })
      for (const file of files) {
        if (file.status === 'uploading' && file.uploadId) {
          try { await objectStorage.abort(file.objectKey, file.uploadId) }
          catch (error) { if (!missingUpload(error)) throw error }
        }
      }
      await objectStorage.deleteKeys(files.map((file) => file.objectKey))
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => {
          const room = await DurableRoom.findOne({ code: claimed.code, status: 'deleting' }).session(session)
          if (!room) return
          await RoomFile.deleteMany({ roomCode: room.code }, { session })
          await RoomActivity.deleteMany({ roomCode: room.code }, { session })
          await RoomGrant.deleteMany({ roomCode: room.code }, { session })
          await StorageQuota.updateOne({ _id: 'global' },
            { $inc: { usedBytes: -room.storageBytes, reservedBytes: -room.reservedBytes } }, { session })
          await DurableRoom.updateOne({ code: room.code }, {
            $set: { status: 'deleted', deletedAt: new Date(), storageBytes: 0, reservedBytes: 0, participants: [] },
            $unset: { recoveryHash: 1, passwordHash: 1, cleanupError: 1, cleanupLeaseUntil: 1 },
          }, { session })
        })
      } finally { await session.endSession() }
      deleted += 1
    } catch (error) {
      failed += 1
      console.error('[cleanup] room', candidate.code, error)
      await DurableRoom.updateOne({ code: candidate.code, status: 'deleting' }, {
        $set: { cleanupError: error instanceof Error ? error.message.slice(0, 500) : 'Unknown failure' },
        $unset: { cleanupLeaseUntil: 1 },
      })
    }
  }
  return { deleted, failed, abandonedUploads }
}
