import { Clock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatCountdown } from '../../utils/formatTime'

interface ExpiryTimerProps {
  expiresAt: Date
  onExpire?: () => void
}

export function ExpiryTimer({ expiresAt, onExpire }: ExpiryTimerProps) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
  )

  useEffect(() => {
    const tick = () => {
      const next = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
      setSecondsLeft(next)
      if (next === 0) onExpire?.()
    }

    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [expiresAt, onExpire])

  return (
    <div
      className="mb-5 inline-flex items-center gap-2 text-sm"
      style={{ color: 'var(--ticket-muted)' }}
    >
      <Clock className="h-4 w-4" />
      <span>
        expires in{' '}
        <span className="font-mono font-semibold">{formatCountdown(secondsLeft)}</span>
      </span>
    </div>
  )
}
