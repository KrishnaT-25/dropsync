import { randomUUID } from 'node:crypto'
import { PutObjectCommand, S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from '../config.js'
import { getRedis } from '../db/redis.js'

const MEMORY_TTL_MS = 15 * 60 * 1000
const REDIS_TTL_SECONDS = 15 * 60

interface MemoryObject {
  buffer: Buffer
  fileName: string
  mimeType: string
  expiresAt: number
}

const memoryStore = new Map<string, MemoryObject>()

function pruneMemory() {
  const now = Date.now()
  for (const [id, obj] of memoryStore) {
    if (obj.expiresAt <= now) memoryStore.delete(id)
  }
}

function getS3(): S3Client | null {
  if (!config.storage) return null
  return new S3Client({
    region: config.storage.region,
    endpoint: config.storage.endpoint,
    credentials: {
      accessKeyId: config.storage.accessKey,
      secretAccessKey: config.storage.secretKey,
    },
    forcePathStyle: true,
  })
}

function redisMetaKey(transferId: string) {
  return `transfer:meta:${transferId}`
}

function redisDataKey(transferId: string) {
  return `transfer:data:${transferId}`
}

export async function storeFallbackFile(input: {
  buffer: Buffer
  fileName: string
  mimeType: string
}): Promise<{ transferId: string; downloadUrl: string; path: 'storage' }> {
  pruneMemory()
  const transferId = randomUUID()

  const s3 = getS3()
  if (s3 && config.storage) {
    const key = `transfers/${transferId}/${encodeURIComponent(input.fileName)}`
    await s3.send(
      new PutObjectCommand({
        Bucket: config.storage.bucket,
        Key: key,
        Body: input.buffer,
        ContentType: input.mimeType,
      }),
    )

    const downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: config.storage.bucket,
        Key: key,
      }),
      { expiresIn: 900 },
    )

    return { transferId, downloadUrl, path: 'storage' }
  }

  // Prefer Redis so any Render instance can serve the download.
  try {
    const redis = getRedis()
    await redis.set(
      redisMetaKey(transferId),
      JSON.stringify({
        fileName: input.fileName,
        mimeType: input.mimeType,
      }),
      'EX',
      REDIS_TTL_SECONDS,
    )
    await redis.set(redisDataKey(transferId), input.buffer, 'EX', REDIS_TTL_SECONDS)
    return {
      transferId,
      downloadUrl: `/api/transfers/${transferId}/download`,
      path: 'storage',
    }
  } catch {
    // Fall through to process memory (single-instance / local dev).
  }

  memoryStore.set(transferId, {
    buffer: input.buffer,
    fileName: input.fileName,
    mimeType: input.mimeType,
    expiresAt: Date.now() + MEMORY_TTL_MS,
  })

  return {
    transferId,
    downloadUrl: `/api/transfers/${transferId}/download`,
    path: 'storage',
  }
}

export async function getFallbackTransfer(
  transferId: string,
): Promise<MemoryObject | null> {
  pruneMemory()

  try {
    const redis = getRedis()
    const [metaRaw, data] = await Promise.all([
      redis.get(redisMetaKey(transferId)),
      redis.getBuffer(redisDataKey(transferId)),
    ])
    if (metaRaw && data) {
      const meta = JSON.parse(metaRaw) as { fileName: string; mimeType: string }
      return {
        buffer: data,
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        expiresAt: Date.now() + MEMORY_TTL_MS,
      }
    }
  } catch {
    // ignore and try memory
  }

  const obj = memoryStore.get(transferId)
  if (!obj) return null
  if (obj.expiresAt <= Date.now()) {
    memoryStore.delete(transferId)
    return null
  }
  return obj
}

/** @deprecated use getFallbackTransfer */
export function getMemoryTransfer(transferId: string): MemoryObject | null {
  pruneMemory()
  const obj = memoryStore.get(transferId)
  if (!obj) return null
  if (obj.expiresAt <= Date.now()) {
    memoryStore.delete(transferId)
    return null
  }
  return obj
}
