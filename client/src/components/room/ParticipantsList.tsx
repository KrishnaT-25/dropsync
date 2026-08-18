import { LogOut, MicOff, MonitorUp, Users, VideoOff } from 'lucide-react'
import type { Participant } from '../../types'

interface ParticipantsListProps {
  participants: Participant[]
  meetingActive?: boolean
  onLeave: () => void
}

export function ParticipantsList({
  participants,
  meetingActive = false,
  onLeave,
}: ParticipantsListProps) {
  return (
    <div>
      <div
        className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em]"
        style={{ color: 'var(--ticket-muted)' }}
      >
        <Users className="h-3.5 w-3.5" />
        Participants
      </div>

      <ul className="space-y-2.5">
        {participants.map((participant) => (
          <li
            key={participant.id}
            className="flex items-center justify-between gap-2 text-sm font-medium"
            style={{ color: 'var(--ticket-text)' }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  participant.inMeeting ? 'bg-red-500' : 'bg-accent'
                }`}
              />
              <span className="truncate">
                {participant.isYou ? 'You' : participant.name === 'You' ? 'Host' : participant.name}
              </span>
            </div>

            {meetingActive && participant.inMeeting && (
              <div className="flex shrink-0 items-center gap-1">
                {participant.isMuted && <MicOff className="h-3.5 w-3.5 text-red-500" />}
                {participant.isCameraOff && <VideoOff className="h-3.5 w-3.5 text-amber-600" />}
                {participant.isScreenSharing && <MonitorUp className="h-3.5 w-3.5 text-accent-muted" />}
              </div>
            )}
          </li>
        ))}
      </ul>

      {meetingActive && (
        <p className="mt-3 text-xs" style={{ color: 'var(--ticket-muted)' }}>
          Red dot = in meeting
        </p>
      )}

      <button
        type="button"
        onClick={onLeave}
        className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-red-500 transition hover:text-red-400"
      >
        <LogOut className="h-4 w-4" />
        Leave room
      </button>
    </div>
  )
}
