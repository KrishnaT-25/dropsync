import type { ReactNode } from 'react'
import { BackgroundMesh } from './BackgroundMesh'

interface AppShellProps {
  children: ReactNode
  centered?: boolean
}

export function AppShell({ children, centered = false }: AppShellProps) {
  return (
    <div className="relative min-h-screen" style={{ background: 'var(--bg)' }}>
      <BackgroundMesh />
      <div
        className={`relative z-10 flex min-h-screen flex-col ${
          centered ? 'items-center justify-center' : ''
        }`}
      >
        {children}
      </div>
    </div>
  )
}
