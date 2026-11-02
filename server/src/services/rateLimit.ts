import { getRedis } from '../db/redis.js'

const INCREMENT_WITH_EXPIRY = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`

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
  const [count, ttl] = await redis.eval(INCREMENT_WITH_EXPIRY, 1, fullKey, windowMs) as [number, number]
  if (count > max) {
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
