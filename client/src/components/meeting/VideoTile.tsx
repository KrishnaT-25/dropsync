import { Maximize2, MicOff, Minimize2, MonitorUp, User, VideoOff, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MeetingTile } from '../../types'

export type VideoTileSize = 'stage' | 'pip' | 'grid'

interface VideoTileProps {
  tile: MeetingTile
  videoRef?: React.RefObject<HTMLVideoElement | null>
  hostMenu?: ReactNode
  size?: VideoTileSize
  onToggleFullscreen?: () => void
  isBrowserFullscreen?: boolean
}

export function VideoTile({
  tile,
  videoRef,
  hostMenu,
  size = 'grid',
  onToggleFullscreen,
  isBrowserFullscreen,
}: VideoTileProps) {
  const internalRef = useRef<HTMLVideoElement>(null)
  const ref = videoRef ?? internalRef
  const isScreen = Boolean(tile.isScreenSharing)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.srcObject = tile.stream ?? null
    if (tile.stream) {
      void video.play().catch(() => {
        // ignore
      })
    }
  }, [tile.stream, ref])

  useEffect(() => {
    const video = ref.current
    if (!video || tile.isYou) return
    video.muted = Boolean(tile.isMuted)
  }, [tile.isMuted, tile.isYou, ref])

  const showPlaceholder =
    !tile.stream || (Boolean(tile.isCameraOff) && !isScreen)

  const shellClass =
    size === 'stage'
      ? 'relative h-full min-h-[280px] w-full overflow-hidden rounded-2xl border sm:min-h-[420px]'
      : size === 'pip'
        ? 'relative aspect-video w-[140px] shrink-0 overflow-hidden rounded-lg border sm:w-[168px]'
        : 'relative aspect-video overflow-hidden rounded-xl border'

  const objectFit = isScreen && size === 'stage' ? 'object-contain' : 'object-cover'

  return (
    <div
      className={shellClass}
      style={{
        background: size === 'stage' ? '#0a0c0f' : 'var(--bg-elevated)',
        borderColor: 'var(--border)',
      }}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={tile.isYou || Boolean(tile.isMuted)}
        className={`h-full w-full ${objectFit} ${showPlaceholder ? 'hidden' : 'block'}`}
      />

      {showPlaceholder && (
        <div className="absolute inset-0 flex h-full w-full items-center justify-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: 'rgba(79, 209, 197, 0.15)' }}
          >
            {isScreen ? (
              <MonitorUp className="h-6 w-6 text-accent" />
            ) : (
              <User className="h-6 w-6 text-accent" />
            )}
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium text-white">
            {tile.id === 'screen-you'
              ? 'Your screen'
              : isScreen && !tile.isYou
                ? `${tile.name}'s screen`
                : tile.isYou
                  ? 'You'
                  : tile.name}
            {tile.isHost && !tile.isYou && !isScreen ? ' · Host' : ''}
          </span>
          <div className="flex items-center gap-1.5">
            {tile.isMuted && <MicOff className="h-3.5 w-3.5 text-red-400" />}
            {tile.isCameraOff && !isScreen && (
              <VideoOff className="h-3.5 w-3.5 text-amber-300" />
            )}
            {isScreen && <MonitorUp className="h-3.5 w-3.5 text-accent" />}
            {!tile.isYou && !isScreen && hostMenu}
            {size === 'stage' && onToggleFullscreen && (
              <button
                type="button"
                onClick={onToggleFullscreen}
                className="ml-1 rounded-md p-1 text-white/90 transition hover:bg-white/10"
                aria-label={isBrowserFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                title={isBrowserFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isBrowserFullscreen ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Floating dismiss control for browser-fullscreen stage chrome (optional overlay). */
export function FullscreenExitHint({ onExit }: { onExit: () => void }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(false), 2500)
    return () => window.clearTimeout(t)
  }, [])
  if (!visible) return null
  return (
    <button
      type="button"
      onClick={onExit}
      className="absolute right-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white"
    >
      <X className="h-3.5 w-3.5" />
      Esc to exit
    </button>
  )
}
