import type { Server, Socket } from 'socket.io'
import { z } from 'zod'
import { getRedis } from '../db/redis.js'
import { roomStore } from '../store/roomStore.js'

type RoomSession = { code: string; participantId: string; senderName: string }
type CallMember = { code: string; participantId: string; name: string; micEnabled: boolean; cameraEnabled: boolean }
const channel = (code: string) => `room-call:${code}`
const permissionsKey = (code: string) => `room-call:permissions:${code}`
const cohostsKey = (code: string) => `room-call:cohosts:${code}`
const blockedKey = (code: string) => `room-call:blocked:${code}`
const approvalsKey = (code: string) => `room-call:approved:${code}`
const mutedKey = (code: string) => `room-call:muted:${code}`
const defaults = { requireAdmission: false, allowScreenShare: true, allowParticipantUnmute: true }
const permissionsSchema = z.object({ requireAdmission: z.boolean(), allowScreenShare: z.boolean(), allowParticipantUnmute: z.boolean() }).strict()
const targetSchema = z.object({ targetParticipantId: z.string().uuid() })
const signalSchema = z.object({
  targetParticipantId: z.string().uuid(),
  senderParticipantId: z.string().uuid(),
  payload: z.unknown(),
})
const mediaSchema = z.object({ micEnabled: z.boolean(), cameraEnabled: z.boolean() })

async function members(io: Server, code: string) {
  const sockets = await io.in(channel(code)).fetchSockets()
  return sockets.flatMap((member) => {
    const call = member.data.roomCall as CallMember | undefined
    return call?.code === code ? [{ ...call, socketId: member.id }] : []
  })
}

async function publish(io: Server, code: string) {
  const [participants, roomSockets, permissions, coHostIds, forcedMutedIds] = await Promise.all([
    members(io, code), io.in(code).fetchSockets(), getPermissions(code), getRedis().smembers(cohostsKey(code)), getRedis().smembers(mutedKey(code)),
  ])
  const waiting = roomSockets.flatMap((member) => member.data.roomCallWaiting === code
    ? [{ participantId: member.data.roomCallWaitingId as string, name: member.data.roomCallWaitingName as string }]
    : [])
  const state = { code, participants: participants.map(({ socketId: _socketId, ...person }) => person), waiting, permissions, coHostIds, forcedMutedIds }
  io.to(code).emit('room-call-state', state)
  return state
}

async function getPermissions(code: string) {
  const saved = await getRedis().get(permissionsKey(code))
  return saved ? { ...defaults, ...JSON.parse(saved) as typeof defaults } : defaults
}

async function expireWithRoom(key: string, expiresAt: string) {
  await getRedis().expireat(key, Math.ceil(new Date(expiresAt).getTime() / 1000))
}

export async function endRoomCall(io: Server, code: string) {
  const sockets = await io.in(channel(code)).fetchSockets()
  for (const member of sockets) {
    member.data.roomCall = null
    await member.leave(channel(code))
    io.to(member.id).emit('room-call-ended')
  }
  await publish(io, code)
}

export function registerRoomCallSocketHandlers(io: Server, socket: Socket, currentRoom: () => RoomSession | null) {
  const validSession = async () => {
    const session = currentRoom()
    if (!session) return null
    const room = await roomStore.getRoom(session.code, false)
    return room?.status === 'active' ? { ...session, room } : null
  }
  const isHost = (session: NonNullable<Awaited<ReturnType<typeof validSession>>>) => session.room.participants[0]?.id === session.participantId
  const isModerator = async (session: NonNullable<Awaited<ReturnType<typeof validSession>>>) => isHost(session) || (await getRedis().sismember(cohostsKey(session.code), session.participantId)) === 1
  const leave = async () => {
    const call = socket.data.roomCall as CallMember | undefined
    const waitingCode = socket.data.roomCallWaiting as string | undefined
    socket.data.roomCallWaiting = null
    if (!call) { if (waitingCode) await publish(io, waitingCode); return }
    socket.data.roomCall = null
    await socket.leave(channel(call.code))
    await publish(io, call.code)
  }
  socket.on('room-call-status', async (_payload, ack) => {
    const session = await validSession()
    if (!session) return ack?.({ ok: false, error: 'Room access denied' })
    ack?.({ ok: true, ...(await publish(io, session.code)) })
  })
  socket.on('room-call-join', async (_payload, ack) => {
    const session = await validSession()
    if (!session) return ack?.({ ok: false, error: 'Room expired or unavailable' })
    if ((await getRedis().sismember(blockedKey(session.code), session.participantId)) === 1) {
      return ack?.({ ok: false, error: 'The host removed you from this call.' })
    }
    const permissions = await getPermissions(session.code)
    if (permissions.requireAdmission && !(await isModerator(session)) && (await getRedis().sismember(approvalsKey(session.code), session.participantId)) !== 1) {
      socket.data.roomCallWaiting = session.code
      socket.data.roomCallWaitingId = session.participantId
      socket.data.roomCallWaitingName = session.senderName
      ack?.({ ok: true, waiting: true })
      await publish(io, session.code)
      return
    }
    socket.data.roomCallWaiting = null
    const lock = `room-call-lock:${session.code}`
    const redis = getRedis()
    let locked = false
    for (let attempt = 0; attempt < 12 && !locked; attempt++) {
      locked = (await redis.set(lock, socket.id, 'PX', 10000, 'NX')) === 'OK'
      if (!locked) await new Promise((resolve) => setTimeout(resolve, 80))
    }
    if (!locked) return ack?.({ ok: false, error: 'Call is busy. Try again.' })
    try {
      const current = await members(io, session.code)
      if (current.some((person) => person.participantId === session.participantId && person.socketId !== socket.id)) {
        return ack?.({ ok: false, error: 'You are already in the call in another tab.' })
      }
      if (current.length >= 6 && !current.some((person) => person.participantId === session.participantId)) {
        return ack?.({ ok: false, error: 'This call is full (6 people).' })
      }
      const micEnabled = (isHost(session) || permissions.allowParticipantUnmute)
        && (await redis.sismember(mutedKey(session.code), session.participantId)) !== 1
      socket.data.roomCall = { code: session.code, participantId: session.participantId, name: session.senderName, micEnabled, cameraEnabled: true } satisfies CallMember
      await socket.join(channel(session.code))
      await redis.srem(approvalsKey(session.code), session.participantId)
      ack?.({ ok: true, ...(await publish(io, session.code)) })
    } finally {
      await redis.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0', 1, lock, socket.id)
    }
  })
  socket.on('room-call-leave', () => { void leave() })
  socket.on('room-call-permissions', async (payload, ack) => {
    const session = await validSession()
    const parsed = permissionsSchema.safeParse(payload)
    if (!session || !isHost(session) || !parsed.success) return ack?.({ ok: false, error: 'Host access required' })
    await getRedis().set(permissionsKey(session.code), JSON.stringify(parsed.data))
    await expireWithRoom(permissionsKey(session.code), session.room.expiresAt)
    ack?.({ ok: true })
    await publish(io, session.code)
  })
  socket.on('room-call-cohost', async (payload, ack) => {
    const session = await validSession()
    const parsed = targetSchema.extend({ enabled: z.boolean() }).safeParse(payload)
    if (!session || !isHost(session) || !parsed.success || parsed.data.targetParticipantId === session.participantId
      || !session.room.participants.some((person) => person.id === parsed.data.targetParticipantId)) return ack?.({ ok: false, error: 'Host access required' })
    if (parsed.data.enabled) await getRedis().sadd(cohostsKey(session.code), parsed.data.targetParticipantId)
    else await getRedis().srem(cohostsKey(session.code), parsed.data.targetParticipantId)
    await expireWithRoom(cohostsKey(session.code), session.room.expiresAt)
    ack?.({ ok: true })
    await publish(io, session.code)
  })
  socket.on('room-call-admit', async (payload, ack) => {
    const session = await validSession()
    const parsed = targetSchema.safeParse(payload)
    if (!session || !(await isModerator(session)) || !parsed.success) return ack?.({ ok: false, error: 'Moderator access required' })
    const target = (await io.in(session.code).fetchSockets()).find((member) => member.data.roomCallWaiting === session.code && member.data.roomCallWaitingId === parsed.data.targetParticipantId)
    if (!target) return ack?.({ ok: false, error: 'Participant is no longer waiting' })
    await getRedis().sadd(approvalsKey(session.code), parsed.data.targetParticipantId)
    await expireWithRoom(approvalsKey(session.code), session.room.expiresAt)
    io.to(target.id).emit('room-call-admitted')
    ack?.({ ok: true })
    await publish(io, session.code)
  })
  socket.on('room-call-deny', async (payload, ack) => {
    const session = await validSession()
    const parsed = targetSchema.safeParse(payload)
    if (!session || !(await isModerator(session)) || !parsed.success) return ack?.({ ok: false, error: 'Moderator access required' })
    const target = (await io.in(session.code).fetchSockets()).find((member) => member.data.roomCallWaiting === session.code && member.data.roomCallWaitingId === parsed.data.targetParticipantId)
    if (!target) return ack?.({ ok: false, error: 'Participant is no longer waiting' })
    io.to(target.id).emit('room-call-denied')
    ack?.({ ok: true })
  })
  socket.on('room-call-moderate', async (payload, ack) => {
    const session = await validSession()
    const parsed = targetSchema.extend({ action: z.enum(['mute', 'unmute', 'remove']) }).safeParse(payload)
    if (!session || !(await isModerator(session)) || !parsed.success || parsed.data.targetParticipantId === session.room.participants[0]?.id) return ack?.({ ok: false, error: 'Moderator access required' })
    const target = (await members(io, session.code)).find((person) => person.participantId === parsed.data.targetParticipantId)
    if (!target) return ack?.({ ok: false, error: 'Participant is not in the call' })
    if (parsed.data.action === 'remove') {
      await getRedis().sadd(blockedKey(session.code), target.participantId)
      await expireWithRoom(blockedKey(session.code), session.room.expiresAt)
      io.in(target.socketId).socketsLeave(channel(session.code))
      io.to(target.socketId).emit('room-call-ended')
    } else {
      if (parsed.data.action === 'mute') await getRedis().sadd(mutedKey(session.code), target.participantId)
      else await getRedis().srem(mutedKey(session.code), target.participantId)
      await expireWithRoom(mutedKey(session.code), session.room.expiresAt)
      const localTarget = io.sockets.sockets.get(target.socketId)
      if (localTarget?.data.roomCall && parsed.data.action === 'mute') {
        localTarget.data.roomCall = { ...(localTarget.data.roomCall as CallMember), micEnabled: false }
      }
      io.to(target.socketId).emit('room-call-force-muted', { muted: parsed.data.action === 'mute' })
    }
    ack?.({ ok: true })
    await publish(io, session.code)
  })
  socket.on('room-call-media', async (payload) => {
    const session = await validSession()
    const call = socket.data.roomCall as CallMember | undefined
    const parsed = mediaSchema.safeParse(payload)
    if (!session || !call || !parsed.success || call.code !== session.code || !socket.rooms.has(channel(session.code))) return
    if (parsed.data.micEnabled && ((await getRedis().sismember(mutedKey(session.code), session.participantId)) === 1 || !(await getPermissions(session.code)).allowParticipantUnmute && !isHost(session))) return
    socket.data.roomCall = { ...call, ...parsed.data }
    await publish(io, session.code)
  })
  for (const event of ['room-call-offer', 'room-call-answer', 'room-call-ice-candidate'] as const) {
    socket.on(event, async (payload) => {
      const session = await validSession()
      const call = socket.data.roomCall as CallMember | undefined
      const parsed = signalSchema.safeParse(payload)
      if (!session || !call || call.code !== session.code || !socket.rooms.has(channel(session.code)) || !parsed.success || parsed.data.senderParticipantId !== session.participantId) return
      if (JSON.stringify(parsed.data.payload ?? null).length > 65_536) return
      const target = (await members(io, session.code)).find((person) => person.participantId === parsed.data.targetParticipantId)
      if (target) io.to(target.socketId).emit(event, parsed.data)
    })
  }
  socket.on('leave-room', () => { void leave() })
  socket.on('disconnect', () => { void leave() })
}
