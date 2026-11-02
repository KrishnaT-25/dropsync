import 'dotenv/config'
import { z } from 'zod'

const optionalUrl = z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined))

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  CLIENT_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  REDIS_URL: z
    .string({ required_error: 'REDIS_URL is required' })
    .min(1, 'REDIS_URL is required')
    .refine(
      (value) => value.startsWith('redis://') || value.startsWith('rediss://'),
      'REDIS_URL must start with redis:// or rediss://',
    ),
  MONGODB_URI: z
    .string({ required_error: 'MONGODB_URI is required' })
    .min(1, 'MONGODB_URI is required')
    .refine(
      (value) => value.startsWith('mongodb://') || value.startsWith('mongodb+srv://'),
      'MONGODB_URI must start with mongodb:// or mongodb+srv://',
    ),
  STUN_URLS: z.string().optional(),
  TURN_URL: optionalUrl,
  TURN_USERNAME: optionalUrl,
  TURN_CREDENTIAL: optionalUrl,
  AWS_REGION: optionalUrl,
  AWS_S3_BUCKET: optionalUrl,
  AWS_ACCESS_KEY_ID: optionalUrl,
  AWS_SECRET_ACCESS_KEY: optionalUrl,
  AWS_SESSION_TOKEN: optionalUrl,
  CLEANUP_SECRET: optionalUrl,
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join('\n')
  console.error(`Invalid environment configuration:\n${issues}`)
  process.exit(1)
}

const stunUrls = (parsed.data.STUN_URLS ?? 'stun:stun.l.google.com:19302')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const turnConfigured = Boolean(
  parsed.data.TURN_URL && parsed.data.TURN_USERNAME && parsed.data.TURN_CREDENTIAL,
)

const storageConfigured = Boolean(
  parsed.data.AWS_REGION &&
    parsed.data.AWS_S3_BUCKET &&
    parsed.data.AWS_ACCESS_KEY_ID &&
    parsed.data.AWS_SECRET_ACCESS_KEY,
)

if (!turnConfigured) {
  console.warn(
    '[ice] TURN is not configured (TURN_URL / TURN_USERNAME / TURN_CREDENTIAL). Cross-network P2P reliability will be degraded; STUN-only mode is active.',
  )
}

if (!storageConfigured) {
  console.warn(
    '[storage] AWS S3 variables not fully configured — recoverable file uploads are disabled.',
  )
}

export const config = {
  port: parsed.data.PORT,
  clientOrigin: parsed.data.CLIENT_ORIGIN,
  redisUrl: parsed.data.REDIS_URL,
  mongodbUri: parsed.data.MONGODB_URI,
  /** Meeting Redis data TTL buffer; room retention is governed by MongoDB timestamps. */
  roomDataTtlBufferSeconds: 60,
  stunUrls,
  turn: turnConfigured
    ? {
        urls: parsed.data.TURN_URL!,
        username: parsed.data.TURN_USERNAME!,
        credential: parsed.data.TURN_CREDENTIAL!,
      }
    : null,
  storage: storageConfigured
    ? {
        region: parsed.data.AWS_REGION!,
        bucket: parsed.data.AWS_S3_BUCKET!,
        accessKey: parsed.data.AWS_ACCESS_KEY_ID!,
        secretKey: parsed.data.AWS_SECRET_ACCESS_KEY!,
        sessionToken: parsed.data.AWS_SESSION_TOKEN,
      }
    : null,
  cleanupSecret: parsed.data.CLEANUP_SECRET,
  minRoomMinutes: 5,
  maxRoomMinutes: 1440,
  recoveryHours: 24,
  maxFileBytes: 500 * 1024 * 1024,
  maxRoomBytes: 2 * 1024 * 1024 * 1024,
  maxGlobalBytes: 8 * 1024 * 1024 * 1024,
} as const
