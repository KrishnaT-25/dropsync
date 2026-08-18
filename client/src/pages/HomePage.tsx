import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Header } from '../components/layout/Header'
import { RoomTabs } from '../components/home/RoomTabs'
import { VideoCallTabs } from '../components/home/VideoCallTabs'
import { useRoom } from '../context/RoomContext'
import { isValidMeetingCode, normalizeMeetingCode } from '../utils/meetingCode'
import { isValidRoomCode, normalizeRoomCode } from '../utils/roomCode'

const features = [
  'Instant file sharing',
  'Standalone video calls',
  'Screen sharing',
  'Universal clipboard',
]

export function HomePage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { joinRoom } = useRoom()

  useEffect(() => {
    const meetCode = searchParams.get('meet')
    if (meetCode && isValidMeetingCode(meetCode)) {
      navigate(`/meet/${normalizeMeetingCode(meetCode)}`, { replace: true })
      return
    }

    const joinCode = searchParams.get('join')
    if (!joinCode || !isValidRoomCode(joinCode)) return
    if (searchParams.get('needPassword') === '1') return

    const normalized = normalizeRoomCode(joinCode)
    void joinRoom(normalized).then((result) => {
      if (result.ok) {
        navigate(`/room/${normalized}`, { replace: true })
        return
      }
      if (result.error === 'password_required') {
        navigate(`/?joinCode=${normalized}&needPassword=1`, { replace: true })
      }
    })
  }, [searchParams, joinRoom, navigate])

  return (
    <AppShell centered>
      <Header />

      <main className="flex w-full flex-1 flex-col items-center px-4 pb-12 pt-2 sm:px-6">
        <div className="animate-fade-up mb-8 max-w-xl text-center sm:mb-10">
          <p className="mb-3 font-mono text-xs font-semibold tracking-[0.35em] text-accent sm:text-sm">
            DROPSYNC
          </p>
          <h1
            className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl"
            style={{ color: 'var(--text-primary)' }}
          >
            Drop into a room.
          </h1>
          <p className="mx-auto max-w-lg text-sm leading-relaxed sm:text-base" style={{ color: 'var(--text-secondary)' }}>
            Share files, text, links, and code across devices — or start a standalone video call.
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {features.map((feature) => (
              <span
                key={feature}
                className="rounded-full border px-3 py-1 text-xs font-medium"
                style={{
                  borderColor: 'var(--border)',
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-elevated)',
                }}
              >
                {feature}
              </span>
            ))}
          </div>
        </div>

        <RoomTabs />
        <VideoCallTabs />

        <p className="mt-8 text-center text-xs sm:text-sm" style={{ color: 'var(--text-muted)' }}>
          No account needed. Rooms expire automatically.
        </p>
      </main>
    </AppShell>
  )
}
