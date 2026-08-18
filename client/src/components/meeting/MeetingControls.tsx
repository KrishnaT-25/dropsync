import {
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Video,
  VideoOff,
} from 'lucide-react'
import { useMeeting } from '../../context/MeetingContext'
import { useMeetingSession } from '../../context/MeetingSessionContext'

export function MeetingControls() {
  const {
    isMuted,
    isCameraOff,
    isScreenSharing,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    leaveOrEnd,
  } = useMeeting()
  const { isHost } = useMeetingSession()

  const buttons = [
    {
      label: isMuted ? 'Unmute' : 'Mute',
      icon: isMuted ? MicOff : Mic,
      active: isMuted,
      onClick: toggleMute,
    },
    {
      label: isCameraOff ? 'Camera on' : 'Camera off',
      icon: isCameraOff ? VideoOff : Video,
      active: isCameraOff,
      onClick: toggleCamera,
    },
    {
      label: isScreenSharing ? 'Stop share' : 'Share screen',
      icon: MonitorUp,
      active: isScreenSharing,
      onClick: () => {
        void toggleScreenShare()
      },
    },
  ]

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
      {buttons.map(({ label, icon: Icon, active, onClick }) => (
        <button
          key={label}
          type="button"
          onClick={onClick}
          aria-label={label}
          title={label}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border transition hover:scale-105 active:scale-95 sm:h-12 sm:w-12"
          style={{
            background: active ? 'rgba(248, 113, 113, 0.12)' : 'var(--bg-elevated)',
            borderColor: active ? 'rgba(248, 113, 113, 0.35)' : 'var(--border)',
            color: active ? '#f87171' : 'var(--text-secondary)',
          }}
        >
          <Icon className="h-5 w-5" />
        </button>
      ))}

      <button
        type="button"
        onClick={leaveOrEnd}
        aria-label={isHost ? 'End meeting' : 'Leave meeting'}
        title={isHost ? 'End meeting for everyone' : 'Leave meeting'}
        className="inline-flex h-11 items-center gap-2 rounded-xl bg-red-500 px-4 text-sm font-semibold text-white transition hover:bg-red-400 active:scale-95 sm:h-12 sm:px-5"
      >
        <PhoneOff className="h-4 w-4" />
        <span className="hidden sm:inline">{isHost ? 'End' : 'Leave'}</span>
      </button>
    </div>
  )
}
