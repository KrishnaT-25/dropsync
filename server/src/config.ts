import 'dotenv/config'
import { z } from 'zod'

const optionalUrl = z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined))

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  CLIENT_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  ROOM_DURATION_SECONDS: z.coerce.number().int().positive().default(300),
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
  STORAGE_ENDPOINT: optionalUrl,
  STORAGE_ACCESS_KEY: optionalUrl,
  STORAGE_SECRET_KEY: optionalUrl,
  STORAGE_BUCKET: optionalUrl,
  STORAGE_REGION: z.string().optional().default('auto'),
  STORAGE_PUBLIC_URL: optionalUrl,
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
  parsed.data.STORAGE_ENDPOINT &&
    parsed.data.STORAGE_ACCESS_KEY &&
    parsed.data.STORAGE_SECRET_KEY &&
    parsed.data.STORAGE_BUCKET,
)

if (!turnConfigured) {
  console.warn(
    '[ice] TURN is not configured (TURN_URL / TURN_USERNAME / TURN_CREDENTIAL). Cross-network P2P reliability will be degraded; STUN-only mode is active.',
  )
}

if (!storageConfigured) {
  console.warn(
    '[storage] STORAGE_* not fully configured — file-transfer fallback will use short-lived in-memory relay on this server instance.',
  )
}

export const config = {
  port: parsed.data.PORT,
  clientOrigin: parsed.data.CLIENT_ORIGIN,
  roomDurationSeconds: parsed.data.ROOM_DURATION_SECONDS,
  redisUrl: parsed.data.REDIS_URL,
  mongodbUri: parsed.data.MONGODB_URI,
  /** Extra seconds kept on room data keys so history can be written after TTL markers fire. */
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
        endpoint: parsed.data.STORAGE_ENDPOINT!,
        accessKey: parsed.data.STORAGE_ACCESS_KEY!,
        secretKey: parsed.data.STORAGE_SECRET_KEY!,
        bucket: parsed.data.STORAGE_BUCKET!,
        region: parsed.data.STORAGE_REGION || 'auto',
        publicUrl: parsed.data.STORAGE_PUBLIC_URL,
      }
    : null,
} as const
