import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { Header } from '../components/layout/Header'
import { ActivityFeed } from '../components/room/ActivityFeed'
import { MessageInput } from '../components/room/MessageInput'
import { RoomSidebar } from '../components/room/RoomSidebar'
import { useRoom } from '../context/RoomContext'
import { normalizeRoomCode } from '../utils/roomCode'

function ConnectionBadge() {
  const { connection } = useRoom()

  if (connection.error) {
    return (
      <span className="rounded-full border border-red-400/30 bg-red-400/10 px-2.5 py-1 text-xs text-red-400">
        Offline
      </span>
    )
  }

  if (!connection.connected) {
    return (
      <span
        className="rounded-full border px-2.5 py-1 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
      >
        Connecting...
      </span>
    )
  }

  return (
    <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs text-accent">
      Live
    </span>
  )
}

export function RoomPage() {
  const { code: paramCode } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const {
    room,
    participantId,
    leaveRoom,
    sendMessage,
    sendClipboard,
    sendCodeSnippet,
    sendFile,
    restoreRoom,
    isLoading,
    connection,
    rateLimitHint,
  } = useRoom()

  useEffect(() => {
    if (!paramCode) {
      navigate('/', { replace: true })
      return
    }

    const normalized = normalizeRoomCode(paramCode)
    if (!room) {
      void restoreRoom(normalized).then((restored) => {
        if (!restored) {
          navigate('/', { replace: true })
        }
      })
    }
  }, [room, paramCode, navigate, restoreRoom])

  if (!room || isLoading) {
    return (
      <AppShell centered>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Loading room...
          </p>
        </div>
      </AppShell>
    )
  }

  const normalizedParam = normalizeRoomCode(paramCode ?? '')
  if (normalizedParam !== room.code) {
    navigate(`/room/${room.code}`, { replace: true })
    return null
  }

  const joinUrl = `${window.location.origin}/?join=${room.code}`

  const handleLeave = () => {
    leaveRoom()
    navigate('/')
  }

  const handleExpire = () => {
    leaveRoom()
    navigate('/')
  }

  return (
    <AppShell>
      <Header
        showOnline
        onlineCount={room.participants.length}
        rightSlot={<ConnectionBadge />}
      />

      {connection.error && (
        <div className="mx-auto mb-2 max-w-6xl px-4 sm:px-6">
          <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-2 text-sm text-red-400">
            {connection.error}
          </p>
        </div>
      )}

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 pb-6 sm:px-6 lg:flex-row lg:gap-6 lg:pb-8">
        <RoomSidebar
          code={room.code}
          joinUrl={joinUrl}
          expiresAt={room.expiresAt}
          participants={room.participants}
          onLeave={handleLeave}
          onExpire={handleExpire}
        />

        <section
          className="flex min-h-[420px] flex-1 flex-col rounded-2xl border p-4 sm:min-h-[520px] sm:p-5 lg:min-h-[calc(100vh-140px)]"
          style={{
            background: 'var(--bg-card)',
            borderColor: 'var(--border)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <ActivityFeed activities={room.activities} selfParticipantId={participantId} />
          <MessageInput
            onSend={sendMessage}
            onSendClipboard={sendClipboard}
            onSendCode={sendCodeSnippet}
            onSendFile={sendFile}
            rateLimitHint={rateLimitHint}
          />
        </section>
      </main>
    </AppShell>
  )
}
