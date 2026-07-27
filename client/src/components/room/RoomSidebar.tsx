import type { Participant } from '../../types'
import { ExpiryTimer } from './ExpiryTimer'
import { ParticipantsList } from './ParticipantsList'
import { RoomCodeDisplay } from './RoomCodeDisplay'

interface RoomSidebarProps {
  code: string
  joinUrl: string
  expiresAt: Date
  participants: Participant[]
  meetingActive?: boolean
  onLeave: () => void
  onExpire?: () => void
}

export function RoomSidebar({
  code,
  joinUrl,
  expiresAt,
  participants,
  meetingActive = false,
  onLeave,
  onExpire,
}: RoomSidebarProps) {
  return (
    <aside className="w-full lg:w-[320px] lg:shrink-0 xl:w-[340px]">
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{
          background: 'var(--ticket-bg)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div
          className="pointer-events-none absolute left-0 top-[52%] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: 'var(--bg)' }}
        />
        <div
          className="pointer-events-none absolute right-0 top-[52%] h-4 w-4 translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: 'var(--bg)' }}
        />

        <div className="p-5 sm:p-6">
          <RoomCodeDisplay code={code} joinUrl={joinUrl} />
          <ExpiryTimer expiresAt={expiresAt} onExpire={onExpire} />
        </div>

        <div
          className="mx-5 border-t border-dashed sm:mx-6"
          style={{ borderColor: 'rgba(28, 25, 23, 0.15)' }}
        />

        <div className="p-5 sm:p-6">
          <ParticipantsList
            participants={participants}
            meetingActive={meetingActive}
            onLeave={onLeave}
          />
        </div>
      </div>
    </aside>
  )
}
