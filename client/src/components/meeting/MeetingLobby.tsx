import { Mic, MicOff, Video, VideoOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useMeeting } from '../../context/MeetingContext'

interface MeetingLobbyProps {
  defaultName?: string
  isHost: boolean
  meetingCode: string
  onJoin: (displayName: string) => Promise<{ ok: boolean; error?: string }>
  joining?: boolean
}

export function MeetingLobby({
  defaultName = '',
  isHost,
  meetingCode,
  onJoin,
  joining = false,
}: MeetingLobbyProps) {
  const {
    isMuted,
    isCameraOff,
    error,
    localVideoRef,
    ensurePreview,
    toggleMute,
    toggleCamera,
  } = useMeeting()
  const [name, setName] = useState(defaultName)
  const [localError, setLocalError] = useState('')
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void ensurePreview()
  }, [ensurePreview])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')
    const trimmed = name.trim()
    if (!trimmed) {
      setLocalError('Enter a display name')
      return
    }
    const result = await onJoin(trimmed)
    if (!result.ok) {
      setLocalError(result.error ?? 'Could not join')
    }
  }

  return (
    <div
      className="mx-auto w-full max-w-lg rounded-2xl border p-5 sm:p-6"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <p
        className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em]"
        style={{ color: 'var(--text-muted)' }}
      >
        {isHost ? 'Start video call' : 'Join video call'}
      </p>
      <h1 className="mb-1 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
        Ready to join?
      </h1>
      <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
        Meeting code{' '}
        <span className="font-mono text-accent">
          {meetingCode.slice(0, 3)}-{meetingCode.slice(3)}
        </span>
      </p>

      <div
        className="relative mb-4 aspect-video overflow-hidden rounded-xl border"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
      >
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${isCameraOff ? 'hidden' : 'block'}`}
        />
        {isCameraOff && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full"
              style={{ background: 'rgba(79, 209, 197, 0.15)' }}
            >
              <VideoOff className="h-6 w-6 text-accent" />
            </div>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 py-3">
          <button
            type="button"
            onClick={toggleMute}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border"
            style={{
              background: isMuted ? 'rgba(248, 113, 113, 0.12)' : 'var(--bg-elevated)',
              borderColor: isMuted ? 'rgba(248, 113, 113, 0.35)' : 'var(--border)',
              color: isMuted ? '#f87171' : 'var(--text-secondary)',
            }}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={toggleCamera}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border"
            style={{
              background: isCameraOff ? 'rgba(248, 113, 113, 0.12)' : 'var(--bg-elevated)',
              borderColor: isCameraOff ? 'rgba(248, 113, 113, 0.35)' : 'var(--border)',
              color: isCameraOff ? '#f87171' : 'var(--text-secondary)',
            }}
            aria-label={isCameraOff ? 'Camera on' : 'Camera off'}
          >
            {isCameraOff ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            Display name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            placeholder="Your name"
            className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-accent"
            style={{
              background: 'var(--bg-elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          />
        </label>

        {(localError || error) && (
          <p className="text-sm text-red-400">{localError || error}</p>
        )}

        <button
          type="submit"
          disabled={joining}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-[#0b0e11] transition hover:bg-accent-hover disabled:opacity-60"
        >
          {joining ? 'Joining…' : isHost ? 'Start call' : 'Join call'}
        </button>
      </form>
    </div>
  )
}
