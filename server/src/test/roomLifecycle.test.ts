import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DurableRoom } from '../models/DurableRoom.js'
import { RoomActivity } from '../models/RoomActivity.js'
import { RoomFile } from '../models/RoomFile.js'
import { RoomGrant } from '../models/RoomGrant.js'
import { StorageQuota } from '../models/StorageQuota.js'
import { objectStorage } from '../services/objectStorage.js'
import { cleanupRooms } from '../services/roomCleanup.js'
import { roomFiles } from '../services/roomFiles.js'
import { flushRateLimitKeys, startTestServer, stopTestServer, type TestHarness } from './helpers.js'

describe('durable rooms and private files', () => {
  let h: TestHarness
  beforeAll(async () => { h = await startTestServer() })
  afterAll(async () => { await stopTestServer() })
  beforeEach(async () => { await flushRateLimitKeys() })
  afterEach(() => { vi.restoreAllMocks() })

  it('requires membership, expires at the exact deadline, and reopens only with the creator key', async () => {
    const created = await h.agent.post('/api/rooms').send({ durationMinutes: 5, password: 'secret1', name: 'DSA Study Group' })
    expect(created.body.room.name).toBe('DSA Study Group')
    expect(created.status).toBe(201)
    const code = created.body.room.code as string
    const token = created.body.accessToken as string
    expect(created.body.recoveryKey).toBeTruthy()

    expect((await h.agent.get(`/api/rooms/${code}`)).status).toBe(401)
    expect((await h.agent.get(`/api/rooms/${code}`).set('Authorization', `Bearer ${token}`)).status).toBe(200)
    expect((await h.agent.post(`/api/rooms/${code}/join`).send({ displayName: 'A' })).status).toBe(401)
    const joined = await h.agent.post(`/api/rooms/${code}/join`).send({ displayName: 'A', password: 'secret1' })
    expect(joined.status).toBe(200)

    await DurableRoom.updateOne({ code }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
    const expired = await h.agent.get(`/api/rooms/${code}`).set('Authorization', `Bearer ${joined.body.accessToken}`)
    expect(expired.body.room.status).toBe('expired_recoverable')
    expect((await h.agent.post(`/api/rooms/${code}/join`).send({ displayName: 'B', password: 'secret1' })).status).toBe(404)
    expect((await h.agent.post(`/api/rooms/${code}/reopen`).send({ recoveryKey: 'wrong-key-with-more-than-20-chars' })).status).toBe(403)

    const reopened = await h.agent.post(`/api/rooms/${code}/reopen`).send({ recoveryKey: created.body.recoveryKey })
    expect(reopened.status).toBe(200)
    expect(reopened.body.room.status).toBe('active')
    expect(reopened.body.room.name).toBe('DSA Study Group')
    expect(new Date(reopened.body.room.expiresAt).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000)
    expect(reopened.body.accessToken).toBeTruthy()

    const deleting = await h.agent.delete(`/api/rooms/${code}`).send({ recoveryKey: created.body.recoveryKey })
    expect(deleting.status).toBe(202)
    expect((await h.agent.get(`/api/rooms/${code}`).set('Authorization', `Bearer ${token}`)).status).toBe(401)
    await cleanupRooms()
    expect((await DurableRoom.findOne({ code }))?.status).toBe('deleted')
    expect(await RoomGrant.countDocuments({ roomCode: code })).toBe(0)
    expect(await RoomActivity.countDocuments({ roomCode: code })).toBe(0)
    expect((await cleanupRooms()).deleted).toBe(0)
  })

  it('reserves capacity and publishes a file only after multipart completion', async () => {
    vi.spyOn(objectStorage, 'configured').mockReturnValue(true)
    vi.spyOn(objectStorage, 'create').mockResolvedValue('upload-1')
    vi.spyOn(objectStorage, 'partUrl').mockResolvedValue('https://example.test/signed-part')
    vi.spyOn(objectStorage, 'parts').mockResolvedValue([{ partNumber: 1, etag: '"etag"' }])
    let completed = false
    vi.spyOn(objectStorage, 'complete').mockImplementation(async () => { completed = true })
    vi.spyOn(objectStorage, 'head').mockImplementation(async () => {
      if (!completed) throw Object.assign(new Error('Access denied for an object not yet created'), { name: 'AccessDenied' })
      return { size: 1024 }
    })
    vi.spyOn(objectStorage, 'downloadUrl').mockResolvedValue('https://example.test/signed-download')

    const created = await h.agent.post('/api/rooms').send({ durationMinutes: 5 })
    const code = created.body.room.code as string
    const auth = `Bearer ${created.body.accessToken}`
    expect((await h.agent.post(`/api/rooms/${code}/files`).send({ fileName: 'a.txt', size: 1024 })).status).toBe(401)
    const started = await h.agent.post(`/api/rooms/${code}/files`).set('Authorization', auth)
      .send({ fileName: 'a.txt', mimeType: 'text/plain', size: 1024 })
    expect(started.status).toBe(201)
    const fileId = started.body.fileId as string
    expect((await h.agent.get(`/api/rooms/${code}/files`).set('Authorization', auth)).body.files).toHaveLength(0)
    expect((await h.agent.post(`/api/rooms/${code}/files/${fileId}/parts/1/url`).set('Authorization', auth)).status).toBe(200)
    expect((await h.agent.post(`/api/rooms/${code}/files/${fileId}/complete`).set('Authorization', auth)).status).toBe(200)
    expect((await h.agent.get(`/api/rooms/${code}/files`).set('Authorization', auth)).body.files).toHaveLength(1)
    expect((await h.agent.get(`/api/rooms/${code}/files/${fileId}/download-url`).set('Authorization', auth)).body.url)
      .toBe('https://example.test/signed-download')
    expect((await RoomFile.findOne({ fileId }))?.status).toBe('ready')
    const other = await h.agent.post('/api/rooms').send({})
    expect((await h.agent.get(`/api/rooms/${code}/files/${fileId}/download-url`)
      .set('Authorization', `Bearer ${other.body.accessToken}`)).status).toBe(401)
    await DurableRoom.updateOne({ code }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await h.agent.get(`/api/rooms/${code}/files/${fileId}/download-url`)
      .set('Authorization', auth)).status).toBe(200)
    expect((await h.agent.post(`/api/rooms/${code}/files`).set('Authorization', auth)
      .send({ fileName: 'b.txt', size: 1 })).status).toBe(409)
  })

  it('enforces the 500 MiB boundary and resumes after a lost completion response', async () => {
    vi.spyOn(objectStorage, 'configured').mockReturnValue(true)
    vi.spyOn(objectStorage, 'create').mockResolvedValue('upload-2')
    vi.spyOn(objectStorage, 'parts').mockRejectedValue(Object.assign(new Error('gone'), { name: 'NoSuchUpload' }))
    vi.spyOn(objectStorage, 'head').mockResolvedValue({ size: 500 * 1024 * 1024 })
    const created = await h.agent.post('/api/rooms').send({})
    const code = created.body.room.code as string
    const auth = `Bearer ${created.body.accessToken}`
    expect((await h.agent.post(`/api/rooms/${code}/files`).set('Authorization', auth)
      .send({ fileName: 'too-big.bin', size: 500 * 1024 * 1024 + 1 })).status).toBe(400)
    const started = await h.agent.post(`/api/rooms/${code}/files`).set('Authorization', auth)
      .send({ fileName: 'large.bin', size: 500 * 1024 * 1024 })
    expect(started.status).toBe(201)
    const status = await h.agent.get(`/api/rooms/${code}/files/${started.body.fileId}/upload-status`)
      .set('Authorization', auth)
    expect(status.body.readyToFinalize).toBe(true)
    expect((await h.agent.post(`/api/rooms/${code}/files/${started.body.fileId}/complete`)
      .set('Authorization', auth)).status).toBe(200)
  })

  it('denies the first request after the recovery deadline even if the server was asleep', async () => {
    const created = await h.agent.post('/api/rooms').send({})
    const code = created.body.room.code as string
    await DurableRoom.updateOne({ code }, { $set: {
      expiresAt: new Date(Date.now() - 2 * 86_400_000),
      recoveryDeadline: new Date(Date.now() - 86_400_000),
    } })
    const response = await h.agent.get(`/api/rooms/${code}`)
      .set('Authorization', `Bearer ${created.body.accessToken}`)
    expect(response.status).toBe(401)
    expect((await DurableRoom.findOne({ code }))?.status).toBe('deleting')
  })

  it('keeps concurrent multipart reservations below the per-room cap', async () => {
    vi.spyOn(objectStorage, 'configured').mockReturnValue(true)
    vi.spyOn(objectStorage, 'create').mockResolvedValue('upload-1')
    const created = await h.agent.post('/api/rooms').send({ durationMinutes: 5 })
    const code = created.body.room.code as string
    const requests = Array.from({ length: 5 }, (_, index) => roomFiles.initiate(code, created.body.participantId, {
      fileName: `large-${index}.bin`, mimeType: 'application/octet-stream', size: 500 * 1024 * 1024,
    }))
    const results = await Promise.allSettled(requests)
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(4)
    const room = await DurableRoom.findOne({ code })
    expect(room?.reservedBytes).toBe(4 * 500 * 1024 * 1024)
    vi.spyOn(objectStorage, 'abort').mockResolvedValue()
    vi.spyOn(objectStorage, 'deleteKeys').mockResolvedValue()
    await DurableRoom.updateOne({ code }, { $set: { status: 'deleting' } })
    await cleanupRooms()
  })

  it('retains deletion state on storage failure and succeeds on retry', async () => {
    const created = await h.agent.post('/api/rooms').send({})
    const code = created.body.room.code as string
    await RoomFile.create({ fileId: crypto.randomUUID(), roomCode: code,
      participantId: created.body.participantId, objectKey: `rooms/${code}/file`,
      fileName: 'file.bin', mimeType: 'application/octet-stream', size: 100,
      status: 'ready', createdAt: new Date() })
    await DurableRoom.updateOne({ code }, { $inc: { storageBytes: 100 } })
    await StorageQuota.updateOne({ _id: 'global' }, { $inc: { usedBytes: 100 } })
    let failTarget = true
    vi.spyOn(objectStorage, 'deleteKeys').mockImplementation(async (keys) => {
      if (failTarget && keys.includes(`rooms/${code}/file`)) {
        failTarget = false
        throw new Error('temporary outage')
      }
    })
    await h.agent.delete(`/api/rooms/${code}`).send({ recoveryKey: created.body.recoveryKey })
    expect((await cleanupRooms()).failed).toBeGreaterThanOrEqual(1)
    expect((await DurableRoom.findOne({ code }))?.status).toBe('deleting')
    await cleanupRooms()
    expect((await DurableRoom.findOne({ code }))?.status).toBe('deleted')
    expect(await RoomFile.countDocuments({ roomCode: code })).toBe(0)
  })
})
