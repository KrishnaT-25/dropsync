import 'dotenv/config'
import { z } from 'zod'

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
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join('\n')
  console.error(`Invalid environment configuration:\n${issues}`)
  process.exit(1)
}

export const config = {
  port: parsed.data.PORT,
  clientOrigin: parsed.data.CLIENT_ORIGIN,
  roomDurationSeconds: parsed.data.ROOM_DURATION_SECONDS,
  redisUrl: parsed.data.REDIS_URL,
  mongodbUri: parsed.data.MONGODB_URI,
  /** Extra seconds kept on room data keys so history can be written after TTL markers fire. */
  roomDataTtlBufferSeconds: 60,
} as const
