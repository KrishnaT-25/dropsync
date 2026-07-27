import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ThemeToggle } from './ThemeToggle'

interface HeaderProps {
  onlineCount?: number
  showOnline?: boolean
  rightSlot?: ReactNode
}

export function Header({ onlineCount = 0, showOnline = false, rightSlot }: HeaderProps) {
  return (
    <header className="relative z-10 flex items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
      <Link
        to="/"
        className="font-mono text-sm font-bold tracking-[0.28em] text-accent transition-opacity hover:opacity-80 sm:text-base"
      >
        DROPSYNC
      </Link>

      <div className="flex items-center gap-3">
        {showOnline && (
          <div
            className="hidden items-center gap-2 rounded-full px-3 py-1.5 text-sm sm:flex"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
            }}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            <span>
              {onlineCount} online
            </span>
          </div>
        )}

        {rightSlot}
        <ThemeToggle />
      </div>
    </header>
  )
}
