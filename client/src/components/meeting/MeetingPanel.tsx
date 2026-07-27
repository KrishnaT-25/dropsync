import { Video } from 'lucide-react'
import { useMeeting } from '../../context/MeetingContext'
import { MeetingControls } from './MeetingControls'
import { VideoTile } from './VideoTile'

export function MeetingPanel() {
  const { isActive, error, tiles, localVideoRef, startMeeting } = useMeeting()

  if (!isActive) {
    return (
      <div
        className="mb-4 rounded-2xl border p-4 sm:p-5"
        style={{
          background: 'var(--bg-elevated)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p
              className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em]"
              style={{ color: 'var(--text-muted)' }}
            >
              Meeting
            </p>
            <p className="text-sm sm:text-[15px]" style={{ color: 'var(--text-secondary)' }}>
              Start a video call to discuss files, notes, and shared content without leaving the room.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void startMeeting()
            }}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-[#0b0e11] transition hover:bg-accent-hover active:scale-[0.98]"
          >
            <Video className="h-4 w-4" />
            Start meeting
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
    )
  }

  return (
    <div
      className="mb-4 rounded-2xl border p-4 sm:p-5"
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: 'var(--text-muted)' }}
        >
          Live meeting
        </p>
        <span className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          In call
        </span>
      </div>

      <div
        className={`mb-4 grid gap-3 ${
          tiles.length > 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'
        }`}
      >
        {tiles.map((tile) => (
          <VideoTile
            key={tile.id}
            tile={tile}
            videoRef={tile.isYou && !tile.isScreenSharing ? localVideoRef : undefined}
          />
        ))}
      </div>

      <MeetingControls />
      {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
    </div>
  )
}
