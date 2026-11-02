import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { config } from '../config.js'
import { DurableRoom } from '../models/DurableRoom.js'
import { RoomActivity } from '../models/RoomActivity.js'
import { RoomFile, type RoomFileDocument } from '../models/RoomFile.js'
import { StorageQuota } from '../models/StorageQuota.js'
import { roomStore } from '../store/roomStore.js'
import { broadcastRoomActivity, broadcastRoomState } from '../socket/index.js'
import { toPublicRoom } from '../utils/publicRoom.js'
import { objectStorage } from './objectStorage.js'

export class FileAccessError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

function limitError(message: string): never { throw new FileAccessError(message, 409) }

async function releaseReservation(file: RoomFileDocument): Promise<void> {
  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      const removed = await RoomFile.findOneAndDelete({ fileId: file.fileId, status: { $in: ['uploading', 'failed'] } }, { session })
      if (!removed) return
      await DurableRoom.updateOne({ code: file.roomCode }, { $inc: { reservedBytes: -file.size } }, { session })
      await StorageQuota.updateOne({ _id: 'global' }, { $inc: { reservedBytes: -file.size } }, { session })
    })
  } finally { await session.endSession() }
}

async function fileForOwner(code: string, fileId: string, participantId: string): Promise<RoomFileDocument> {
  const file = await RoomFile.findOne({ roomCode: code, fileId, participantId })
  if (!file) throw new FileAccessError('File not found', 404)
  return file
}

export const roomFiles = {
  async initiate(code: string, participantId: string, input: {
    fileName: string; mimeType: string; size: number; fingerprint?: string
  }) {
    if (!objectStorage.configured()) throw new FileAccessError('Storage is not configured', 503)
    const room = await roomStore.getRoom(code, false)
    if (!room) throw new FileAccessError('Room is not active', 409)
    const size = input.size
    if (!Number.isSafeInteger(size) || size < 1 || size > config.maxFileBytes) {
      throw new FileAccessError('File exceeds the 500 MiB limit', 400)
    }
    const fileName = input.fileName.replace(/[\\/\r\n]/g, '_').trim().slice(0, 255)
    if (!fileName) throw new FileAccessError('File name required', 400)
    const mimeType = input.mimeType.trim().slice(0, 150) || 'application/octet-stream'
    const fileId = randomUUID()
    const objectKey = `rooms/${code}/${fileId}`
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        const quota = await StorageQuota.findOneAndUpdate(
          { _id: 'global', $expr: { $lte: [{ $add: ['$usedBytes', '$reservedBytes', size] }, config.maxGlobalBytes] } },
          { $inc: { reservedBytes: size } }, { session, returnDocument: 'after' },
        )
        if (!quota) limitError('App storage is full')
        const updated = await DurableRoom.findOneAndUpdate(
          { code, status: 'active', expiresAt: { $gt: new Date() },
            $expr: { $lte: [{ $add: ['$storageBytes', '$reservedBytes', size] }, config.maxRoomBytes] } },
          { $inc: { reservedBytes: size } }, { session, returnDocument: 'after' },
        )
        if (!updated) limitError('Room storage is full or expired')
        await RoomFile.create([{ fileId, roomCode: code, participantId, objectKey,
          fileName, mimeType, size, status: 'uploading', createdAt: new Date(),
          fingerprint: input.fingerprint }], { session })
      })
    } finally { await session.endSession() }

    let uploadId: string | undefined
    try {
      uploadId = await objectStorage.create(objectKey, mimeType)
      const result = await RoomFile.updateOne({ fileId, status: 'uploading' }, { $set: { uploadId } })
      if (!result.modifiedCount) throw new Error('Upload record disappeared')
    } catch (error) {
      if (uploadId) {
        try { await objectStorage.abort(objectKey, uploadId) }
        catch (abortError) { console.error('[files] failed to abort untracked upload', abortError) }
      }
      const file = await RoomFile.findOne({ fileId })
      if (file) await releaseReservation(file)
      throw error
    }
    return { fileId, partSize: objectStorage.partSize, partCount: Math.ceil(size / objectStorage.partSize) }
  },

  async partUrl(code: string, fileId: string, participantId: string, partNumber: number) {
    const room = await roomStore.getRoom(code, false)
    if (!room) throw new FileAccessError('Room is not active', 409)
    const file = await fileForOwner(code, fileId, participantId)
    const maxPart = Math.ceil(file.size / objectStorage.partSize)
    if (file.status !== 'uploading' || !file.uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > maxPart) {
      throw new FileAccessError('Invalid upload part', 400)
    }
    return { url: await objectStorage.partUrl(file.objectKey, file.uploadId, partNumber), expiresIn: 300 }
  },

  async uploadStatus(code: string, fileId: string, participantId: string) {
    const file = await fileForOwner(code, fileId, participantId)
    if (file.status !== 'uploading' || !file.uploadId) throw new FileAccessError('Upload unavailable', 409)
    try {
      return { fileId, fileName: file.fileName, size: file.size, fingerprint: file.fingerprint,
        partSize: objectStorage.partSize, parts: await objectStorage.parts(file.objectKey, file.uploadId), readyToFinalize: false }
    } catch (error) {
      const name = (error as { name?: string }).name
      if (name !== 'NoSuchUpload' && name !== 'NotFound') throw error
      const head = await objectStorage.head(file.objectKey)
      if (!head || head.size !== file.size) throw error
      return { fileId, fileName: file.fileName, size: file.size, fingerprint: file.fingerprint,
        partSize: objectStorage.partSize, parts: [], readyToFinalize: true }
    }
  },

  async complete(code: string, fileId: string, participantId: string) {
    const room = await roomStore.getRoom(code, false)
    if (!room) throw new FileAccessError('Room is not active', 409)
    const file = await fileForOwner(code, fileId, participantId)
    if (file.status === 'ready') return file
    if (file.status !== 'uploading' || !file.uploadId) throw new FileAccessError('Upload unavailable', 409)
    let head = await objectStorage.head(file.objectKey)
    if (!head) {
      const parts = await objectStorage.parts(file.objectKey, file.uploadId)
      const expected = Math.ceil(file.size / objectStorage.partSize)
      if (parts.length !== expected || parts.some((part, i) => part.partNumber !== i + 1)) {
        throw new FileAccessError('Upload has missing parts', 409)
      }
      await objectStorage.complete(file.objectKey, file.uploadId, parts)
      head = await objectStorage.head(file.objectKey)
    }
    if (!head || head.size !== file.size || !(await roomStore.getRoom(code, false))) {
      await objectStorage.deleteKeys([file.objectKey])
      await releaseReservation(file)
      throw new FileAccessError('Upload size mismatch or room expired', 409)
    }
    const session = await mongoose.startSession()
    const item = {
      id: randomUUID(), type: 'file' as const, content: file.fileName,
      sender: room.participants.find((p) => p.id === participantId)?.name ?? 'Guest',
      senderId: participantId, timestamp: new Date().toISOString(),
      fileMeta: { fileName: file.fileName, fileSize: file.size, mimeType: file.mimeType,
        transferId: file.fileId, status: 'complete' as const, transferPath: 'storage' as const },
    }
    let published = false
    try {
      await session.withTransaction(async () => {
        const updated = await RoomFile.findOneAndUpdate(
          { fileId, status: 'uploading' }, { $set: { status: 'ready', completedAt: new Date() }, $unset: { uploadId: 1 } },
          { session, returnDocument: 'after' },
        )
        if (!updated) return
        const changed = await DurableRoom.updateOne(
          { code, status: 'active', expiresAt: { $gt: new Date() } },
          { $inc: { reservedBytes: -file.size, storageBytes: file.size } }, { session },
        )
        if (!changed.modifiedCount) throw new FileAccessError('Room expired during upload', 409)
        await StorageQuota.updateOne({ _id: 'global' }, { $inc: { reservedBytes: -file.size, usedBytes: file.size } }, { session })
        await RoomActivity.create([{ roomCode: code, ...item }], { session })
        published = true
      })
    } catch (error) {
      if (error instanceof FileAccessError) {
        await objectStorage.deleteKeys([file.objectKey])
        await releaseReservation(file)
      }
      throw error
    } finally { await session.endSession() }
    if (published) broadcastRoomActivity(code, item)
    const fresh = await roomStore.getRoom(code)
    if (fresh) broadcastRoomState(code, toPublicRoom(fresh))
    return RoomFile.findOne({ fileId })
  },

  async abort(code: string, fileId: string, participantId: string) {
    const file = await fileForOwner(code, fileId, participantId)
    if (file.status !== 'uploading') return
    if (file.uploadId) await objectStorage.abort(file.objectKey, file.uploadId)
    await releaseReservation(file)
  },

  async list(code: string) {
    return RoomFile.find({ roomCode: code, status: 'ready' })
      .select('fileId fileName mimeType size createdAt completedAt -_id').sort({ createdAt: 1 }).lean()
  },

  async downloadUrl(code: string, fileId: string) {
    const file = await RoomFile.findOne({ roomCode: code, fileId, status: 'ready' })
    if (!file) throw new FileAccessError('File not found', 404)
    return { url: await objectStorage.downloadUrl(file.objectKey, file.fileName), expiresIn: 300,
      fileName: file.fileName }
  },
}
