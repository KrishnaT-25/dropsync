import { Copy, Check } from 'lucide-react'
import { useState } from 'react'
import { useMeeting } from '../../context/MeetingContext'
import { useMeetingSession } from '../../context/MeetingSessionContext'
import { HostParticipantMenu } from './HostParticipantMenu'
import { MeetingControls } from './MeetingControls'
import { VideoTile } from './VideoTile'

export function MeetingPanel() {
  const { error, tiles, localVideoRef } = useMeeting()
  const { meeting, isHost, activityLog, participantId } = useMeetingSession()
  const [copied, setCopied] = useState(false)

  const inviteUrl = meeting ? `${window.location.origin}/meet/${meeting.code}` : ''

  const copyInvite = async () => {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div
      className="rounded-2xl border p-4 sm:p-5"
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.2em]"
            style={{ color: 'var(--text-muted)' }}
          >
            Live meeting
          </p>
          {meeting && (
            <p className="mt-1 font-mono text-sm text-accent">
              {meeting.code.slice(0, 3)}-{meeting.code.slice(3)}
              {isHost ? ' · Host' : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void copyInvite()}
            className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text-secondary)',
              background: 'var(--bg-card)',
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <span className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            In call
          </span>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tiles.map((tile) => (
          <VideoTile
            key={tile.id}
            tile={tile}
            videoRef={tile.isYou && !tile.isScreenSharing ? localVideoRef : undefined}
            hostMenu={
              !tile.isYou && !tile.isScreenSharing ? (
                <HostParticipantMenu participantId={tile.id} participantName={tile.name} />
              ) : undefined
            }
          />
        ))}
      </div>

      <MeetingControls />
      {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}

      {activityLog.length > 0 && (
        <ul className="mt-4 space-y-1 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          {activityLog.slice(-6).map((item) => {
            const who = item.actorId === participantId ? 'You' : item.actorName
            return (
              <li key={item.id} className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                {who} {item.content}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
