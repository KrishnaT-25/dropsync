import { MicOff, MonitorUp, User, VideoOff } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { MeetingTile } from '../../types'

interface VideoTileProps {
  tile: MeetingTile
  videoRef?: React.RefObject<HTMLVideoElement | null>
}

export function VideoTile({ tile, videoRef }: VideoTileProps) {
  const internalRef = useRef<HTMLVideoElement>(null)
  const ref = videoRef ?? internalRef

  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.srcObject = tile.stream ?? null
  }, [tile.stream, ref])

  const showPlaceholder = !tile.stream || tile.isCameraOff

  return (
    <div
      className="relative aspect-video overflow-hidden rounded-xl border"
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border)',
      }}
    >
      {!showPlaceholder ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={tile.isYou}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: 'rgba(79, 209, 197, 0.15)' }}
          >
            {tile.isScreenSharing ? (
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
            {tile.name}
            {tile.isYou ? ' (You)' : ''}
          </span>
          <div className="flex items-center gap-1.5">
            {tile.isMuted && <MicOff className="h-3.5 w-3.5 text-red-400" />}
            {tile.isCameraOff && !tile.isScreenSharing && (
              <VideoOff className="h-3.5 w-3.5 text-amber-300" />
            )}
            {tile.isScreenSharing && <MonitorUp className="h-3.5 w-3.5 text-accent" />}
          </div>
        </div>
      </div>
    </div>
  )
}
