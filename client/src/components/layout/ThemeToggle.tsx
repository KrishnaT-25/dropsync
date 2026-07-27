import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'

interface ThemeToggleProps {
  className?: string
}

export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`group inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-all duration-200 hover:scale-105 active:scale-95 ${className}`}
      style={{
        borderColor: 'var(--border-strong)',
        background: 'var(--bg-elevated)',
        color: 'var(--text-secondary)',
      }}
    >
      {isDark ? (
        <Sun className="h-[18px] w-[18px] text-accent transition-transform group-hover:rotate-12" />
      ) : (
        <Moon className="h-[18px] w-[18px] text-accent transition-transform group-hover:-rotate-12" />
      )}
    </button>
  )
}
