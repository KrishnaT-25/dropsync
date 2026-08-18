import { MoreVertical } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useMeetingSession } from '../../context/MeetingSessionContext'

interface HostParticipantMenuProps {
  participantId: string
  participantName: string
}

export function HostParticipantMenu({ participantId, participantName }: HostParticipantMenuProps) {
  const { isHost, hostMute, hostRemove } = useMeetingSession()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!isHost) return null

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/20 bg-black/40 text-white/90 hover:bg-black/60"
        aria-label={`Controls for ${participantName}`}
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          className="absolute right-0 bottom-9 z-10 min-w-[140px] rounded-xl border py-1 shadow-lg"
          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
        >
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-xs hover:bg-black/10"
            style={{ color: 'var(--text-primary)' }}
            onClick={() => {
              hostMute(participantId)
              setOpen(false)
            }}
          >
            Mute
          </button>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-black/10"
            onClick={() => {
              hostRemove(participantId)
              setOpen(false)
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  )
}
