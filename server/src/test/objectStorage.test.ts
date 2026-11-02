import { afterEach, describe, expect, it } from 'vitest'
import { config } from '../config.js'
import { objectStorage } from '../services/objectStorage.js'

describe('AWS S3 signed storage URLs', () => {
  const original = config.storage

  afterEach(() => { Object.assign(config, { storage: original }) })

  it('signs multipart and download requests for the configured AWS region', async () => {
    Object.assign(config, { storage: {
      region: 'us-east-1', bucket: 'dropsync-test-bucket',
      accessKey: 'AKIATESTONLY', secretKey: 'test-secret-key', sessionToken: undefined,
    } })

    const part = new URL(await objectStorage.partUrl('rooms/ABC123/file', 'test-upload-id', 1))
    expect(part.hostname).toBe('dropsync-test-bucket.s3.us-east-1.amazonaws.com')
    expect(part.searchParams.get('X-Amz-Expires')).toBe('300')
    expect(part.searchParams.get('partNumber')).toBe('1')
    expect(part.searchParams.get('uploadId')).toBe('test-upload-id')

    const download = new URL(await objectStorage.downloadUrl('rooms/ABC123/file', 'report.txt'))
    expect(download.hostname).toBe(part.hostname)
    expect(download.searchParams.get('X-Amz-Expires')).toBe('300')
  })
})
