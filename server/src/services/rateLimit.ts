import { getRedis } from '../db/redis.js'

export interface RateLimitResult {
  allowed: boolean
  retryAfterMs?: number
}

/**
 * Fixed-window counter in Redis.
 * key lives for `windowMs`; when count exceeds `max`, reject.
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const redis = getRedis()
  const fullKey = `rl:${key}`
  const count = await redis.incr(fullKey)
  if (count === 1) {
    await redis.pexpire(fullKey, windowMs)
  }
  if (count > max) {
    const ttl = await redis.pttl(fullKey)
    return { allowed: false, retryAfterMs: ttl > 0 ? ttl : windowMs }
  }
  return { allowed: true }
}

export const RATE_LIMITS = {
  activity: { max: 10, windowMs: 10_000 },
  joinIp: { max: 20, windowMs: 60_000 },
  createIp: { max: 10, windowMs: 60_000 },
} as const

export function clientIpFromSocket(handshake: {
  address: string
  headers: Record<string, string | string[] | undefined>
}): string {
  const forwarded = handshake.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim()
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(',')[0]!.trim()
  }
  return handshake.address || 'unknown'
}

export function clientIpFromRequest(req: {
  ip?: string
  headers: Record<string, string | string[] | undefined>
  socket: { remoteAddress?: string }
}): string {
  if (req.ip) return req.ip
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim()
  }
  return req.socket.remoteAddress || 'unknown'
}
