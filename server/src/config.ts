import 'dotenv/config'

export const config = {
  port: Number(process.env.PORT ?? 3001),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  roomDurationSeconds: Number(process.env.ROOM_DURATION_SECONDS ?? 300),
}
