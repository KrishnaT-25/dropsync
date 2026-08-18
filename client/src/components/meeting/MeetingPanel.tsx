import { Copy, Check } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMeeting } from '../../context/MeetingContext'
import { useMeetingSession } from '../../context/MeetingSessionContext'
import type { MeetingTile } from '../../types'
import { HostParticipantMenu } from './HostParticipantMenu'
import { MeetingControls } from './MeetingControls'
import { FullscreenExitHint, VideoTile } from './VideoTile'

function pickScreenStage(tiles: MeetingTile[]): MeetingTile | null {
  const localScreen = tiles.find((t) => t.id === 'screen-you' && t.stream)
  if (localScreen) return localScreen
  // Any remote currently sharing — their video track is the screen via replaceTrack.
  return (
    tiles.find((t) => Boolean(t.isScreenSharing) && Boolean(t.stream) && !t.isYou) ??
    tiles.find((t) => Boolean(t.isScreenSharing) && Boolean(t.stream)) ??
    null
  )
}

function pickStage(tiles: MeetingTile[], pinnedId: string | null): MeetingTile | null {
  if (pinnedId) {
    const pinned = tiles.find((t) => t.id === pinnedId && t.stream)
    if (pinned) return pinned
  }
  return pickScreenStage(tiles)
}

export function MeetingPanel() {
  const { error, tiles, localVideoRef, screenVideoRef } = useMeeting()
  const { meeting, isHost, activityLog, participantId, rateLimitHint } = useMeetingSession()
  const [copied, setCopied] = useState(false)
  const [browserFs, setBrowserFs] = useState(false)
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const stageShellRef = useRef<HTMLDivElement>(null)
  const prevScreenIdRef = useRef<string | null>(null)

  const inviteUrl = meeting ? `${window.location.origin}/meet/${meeting.code}` : ''

  const activeScreen = useMemo(() => pickScreenStage(tiles), [tiles])

  // When someone starts sharing, focus their screen (clear conflicting pin).
  useEffect(() => {
    const id = activeScreen?.id ?? null
    if (id && id !== prevScreenIdRef.current) {
      setPinnedId(null)
    }
    prevScreenIdRef.current = id
  }, [activeScreen?.id])

  const stageTile = useMemo(() => pickStage(tiles, pinnedId), [tiles, pinnedId])
  const stripTiles = useMemo(() => {
    if (!stageTile) return tiles
    return tiles.filter((t) => t.id !== stageTile.id)
  }, [tiles, stageTile])

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

  useEffect(() => {
    const onFsChange = () => {
      setBrowserFs(document.fullscreenElement === stageShellRef.current)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const el = stageShellRef.current
    if (!el) return
    try {
      if (document.fullscreenElement === el) await document.exitFullscreen()
      else await el.requestFullscreen()
    } catch {
      // ignore
    }
  }, [])

  const togglePin = useCallback((tileId: string) => {
    setPinnedId((prev) => (prev === tileId ? null : tileId))
  }, [])

  const renderTile = (tile: MeetingTile, size: 'stage' | 'pip' | 'grid') => (
    <VideoTile
      key={tile.id}
      tile={tile}
      size={size}
      pinned={pinnedId === tile.id}
      onTogglePin={() => togglePin(tile.id)}
      videoRef={
        tile.id === 'screen-you'
          ? screenVideoRef
          : tile.isYou && tile.id !== 'screen-you'
            ? localVideoRef
            : undefined
      }
      isBrowserFullscreen={size === 'stage' ? browserFs : undefined}
      onToggleFullscreen={size === 'stage' ? () => void toggleFullscreen() : undefined}
      hostMenu={
        !tile.isYou && tile.id !== 'screen-you' ? (
          <HostParticipantMenu participantId={tile.id} participantName={tile.name} />
        ) : undefined
      }
    />
  )

  return (
    <div
      className="rounded-2xl border p-3 sm:p-5"
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 sm:mb-4">
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

      {stageTile ? (
        <div className="mb-3 flex flex-col gap-3 sm:mb-4">
          <div
            ref={stageShellRef}
            className="relative h-[min(68vh,720px)] w-full bg-black sm:h-[min(72vh,820px)]"
          >
            {renderTile(stageTile, 'stage')}
            {browserFs && (
              <FullscreenExitHint onExit={() => void document.exitFullscreen()} />
            )}
          </div>
          {stripTiles.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {stripTiles.map((tile) => renderTile(tile, 'pip'))}
            </div>
          )}
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((tile) => renderTile(tile, 'grid'))}
        </div>
      )}

      <MeetingControls />
      {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
      {rateLimitHint && (
        <p className="mt-2 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          {rateLimitHint}
        </p>
      )}

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
