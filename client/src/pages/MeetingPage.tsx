import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MeetingEndedScreen } from '../components/meeting/MeetingEndedScreen'
import { MeetingLobby } from '../components/meeting/MeetingLobby'
import { MeetingPanel } from '../components/meeting/MeetingPanel'
import { AppShell } from '../components/layout/AppShell'
import { Header } from '../components/layout/Header'
import { MeetingProvider } from '../context/MeetingContext'
import { MeetingSessionProvider, useMeetingSession } from '../context/MeetingSessionContext'
import * as meetingApi from '../services/meetingApi'
import { isValidMeetingCode, normalizeMeetingCode } from '../utils/meetingCode'

function MeetingContent() {
  const { meetingCode: paramCode } = useParams<{ meetingCode: string }>()
  const navigate = useNavigate()
  const {
    meeting,
    participantId,
    isJoined,
    exitReason,
    joinAsGuest,
    enterCall,
    clearExit,
    hydrateFromStorage,
  } = useMeetingSession()
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [bootError, setBootError] = useState('')

  useEffect(() => {
    if (!paramCode || !isValidMeetingCode(paramCode)) {
      navigate('/', { replace: true })
      return
    }

    const code = normalizeMeetingCode(paramCode)
    let cancelled = false

    void (async () => {
      setLoading(true)
      setBootError('')
      hydrateFromStorage(code)

      try {
        await meetingApi.getMeeting(code)
        if (!cancelled) setLoading(false)
      } catch {
        if (!cancelled) {
          setBootError('This meeting was not found or has ended.')
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [paramCode, navigate, hydrateFromStorage])

  if (exitReason) {
    return (
      <AppShell centered>
        <MeetingEndedScreen reason={exitReason} />
      </AppShell>
    )
  }

  if (loading) {
    return (
      <AppShell centered>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Loading meeting...
          </p>
        </div>
      </AppShell>
    )
  }

  if (bootError) {
    return (
      <AppShell centered>
        <div
          className="max-w-md rounded-2xl border p-6 text-center"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <p className="mb-4 text-sm text-red-400">{bootError}</p>
          <button
            type="button"
            onClick={() => {
              clearExit()
              navigate('/')
            }}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-[#0b0e11]"
          >
            Back to home
          </button>
        </div>
      </AppShell>
    )
  }

  const code = normalizeMeetingCode(paramCode ?? '')
  const hostPrepared = Boolean(
    participantId && (meeting?.hostParticipantId === participantId || meeting?.participants.some((p) => p.id === participantId && p.isHost)),
  )

  if (!isJoined) {
    return (
      <AppShell centered>
        <Header />
        <main className="flex w-full flex-1 flex-col items-center px-4 pb-12 pt-2">
          <MeetingLobby
            isHost={hostPrepared}
            meetingCode={code}
            joining={joining}
            onJoin={async (displayName) => {
              setJoining(true)
              try {
                if (!hostPrepared) {
                  const guest = await joinAsGuest(code, displayName)
                  if (!guest.ok) return guest
                }
                return await enterCall(displayName)
              } finally {
                setJoining(false)
              }
            }}
          />
        </main>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <Header
        showOnline
        onlineCount={meeting?.participants.length}
        rightSlot={
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs text-accent">
            Live
          </span>
        }
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-8 sm:px-6">
        <MeetingPanel />
      </main>
    </AppShell>
  )
}

export function MeetingPage() {
  return (
    <MeetingSessionProvider>
      <MeetingProvider>
        <MeetingContent />
      </MeetingProvider>
    </MeetingSessionProvider>
  )
}
