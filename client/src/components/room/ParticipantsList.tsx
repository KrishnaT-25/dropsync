import { LogOut, Users } from 'lucide-react'
import type { Participant } from '../../types'

interface ParticipantsListProps {
  participants: Participant[]
  onLeave: () => void
}

export function ParticipantsList({ participants, onLeave }: ParticipantsListProps) {
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
              <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
              <span className="truncate">
                {participant.isYou ? 'You' : participant.name === 'You' ? 'Host' : participant.name}
              </span>
            </div>
          </li>
        ))}
      </ul>

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
