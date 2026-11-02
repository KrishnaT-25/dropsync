import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand, DeleteObjectsCommand, GetObjectCommand,
  HeadObjectCommand, ListPartsCommand, S3Client, UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from '../config.js'

const PART_SIZE = 16 * 1024 * 1024
const URL_SECONDS = 300

function client(): S3Client {
  if (!config.storage) throw new Error('AWS S3 storage is not configured')
  return new S3Client({
    region: config.storage.region,
    credentials: { accessKeyId: config.storage.accessKey, secretAccessKey: config.storage.secretKey,
      ...(config.storage.sessionToken ? { sessionToken: config.storage.sessionToken } : {}) },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

function bucket(): string {
  if (!config.storage) throw new Error('AWS S3 storage is not configured')
  return config.storage.bucket
}

export const objectStorage = {
  partSize: PART_SIZE,
  configured: () => Boolean(config.storage),
  async create(key: string, mimeType: string): Promise<string> {
    const result = await client().send(new CreateMultipartUploadCommand({
      Bucket: bucket(), Key: key, ContentType: mimeType,
    }))
    if (!result.UploadId) throw new Error('Storage did not return an upload ID')
    return result.UploadId
  },
  async partUrl(key: string, uploadId: string, partNumber: number): Promise<string> {
    return getSignedUrl(client(), new UploadPartCommand({
      Bucket: bucket(), Key: key, UploadId: uploadId, PartNumber: partNumber,
    }), { expiresIn: URL_SECONDS })
  },
  async parts(key: string, uploadId: string): Promise<Array<{ partNumber: number; etag: string }>> {
    const result: Array<{ partNumber: number; etag: string }> = []
    let marker: string | undefined
    do {
      const page = await client().send(new ListPartsCommand({
        Bucket: bucket(), Key: key, UploadId: uploadId, PartNumberMarker: marker,
      }))
      for (const part of page.Parts ?? []) {
        if (part.PartNumber && part.ETag) result.push({ partNumber: part.PartNumber, etag: part.ETag })
      }
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined
    } while (marker)
    return result
  },
  async complete(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<void> {
    await client().send(new CompleteMultipartUploadCommand({
      Bucket: bucket(), Key: key, UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) },
    }))
  },
  async abort(key: string, uploadId: string): Promise<void> {
    await client().send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }))
  },
  async head(key: string): Promise<{ size: number } | null> {
    try {
      const result = await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }))
      return { size: Number(result.ContentLength ?? -1) }
    } catch (error: unknown) {
      const code = (error as { name?: string }).name
      if (code === 'NotFound' || code === 'NoSuchKey') return null
      throw error
    }
  },
  async downloadUrl(key: string, fileName: string): Promise<string> {
    return getSignedUrl(client(), new GetObjectCommand({
      Bucket: bucket(), Key: key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    }), { expiresIn: URL_SECONDS })
  },
  async deleteKeys(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000)
      if (!batch.length) continue
      const result = await client().send(new DeleteObjectsCommand({
        Bucket: bucket(), Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }))
      if (result.Errors?.length) throw new Error(`Failed to delete ${result.Errors.length} storage objects`)
    }
  },
}
