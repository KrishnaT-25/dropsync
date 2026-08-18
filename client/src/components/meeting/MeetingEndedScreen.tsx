import { useNavigate } from 'react-router-dom'
import type { MeetingExitReason } from '../../types'

interface MeetingEndedScreenProps {
  reason: MeetingExitReason
}

export function MeetingEndedScreen({ reason }: MeetingEndedScreenProps) {
  const navigate = useNavigate()

  const message =
    reason === 'removed'
      ? 'You were removed from the meeting by the host.'
      : reason === 'host_ended'
        ? 'The meeting was ended by the host.'
        : reason === 'host_left'
          ? 'The host left — this meeting has ended.'
          : 'You left the meeting.'

  return (
    <div
      className="mx-auto w-full max-w-md rounded-2xl border p-6 text-center"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <h1 className="mb-2 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
        Meeting ended
      </h1>
      <p className="mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
        {message}
      </p>
      <button
        type="button"
        onClick={() => navigate('/')}
        className="inline-flex items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-[#0b0e11] transition hover:bg-accent-hover"
      >
        Back to home
      </button>
    </div>
  )
}
