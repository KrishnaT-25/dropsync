import { ArrowRight, Loader2, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRoom } from '../../context/RoomContext'
import { isValidRoomCode, normalizeRoomCode } from '../../utils/roomCode'

type Tab = 'create' | 'join'

function formatJoinCode(value: string): string {
  const cleaned = normalizeRoomCode(value)
  if (cleaned.length <= 3) return cleaned
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`
}

export function RoomTabs() {
  const [tab, setTab] = useState<Tab>('create')
  const [joinCode, setJoinCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [showCreatePassword, setShowCreatePassword] = useState(false)
  const [joinPassword, setJoinPassword] = useState('')
  const [showJoinPassword, setShowJoinPassword] = useState(false)
  const [error, setError] = useState('')
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { createRoom, joinRoom, isLoading } = useRoom()

  useEffect(() => {
    const presetCode = searchParams.get('joinCode') ?? searchParams.get('join')
    const needPassword = searchParams.get('needPassword') === '1'
    if (presetCode && isValidRoomCode(presetCode)) {
      setTab('join')
      setJoinCode(formatJoinCode(presetCode))
      if (needPassword) {
        setShowJoinPassword(true)
        setError('This room requires a password')
      }
    }
  }, [searchParams])

  const handleCreate = async () => {
    setError('')
    if (showCreatePassword && createPassword.trim().length > 0 && createPassword.trim().length < 4) {
      setError('Password must be at least 4 characters')
      return
    }

    try {
      const password =
        showCreatePassword && createPassword.trim().length > 0
          ? createPassword.trim()
          : undefined
      const code = await createRoom(password)
      navigate(`/room/${code}`)
    } catch {
      setError('Could not create room. Is the server running?')
    }
  }

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!isValidRoomCode(joinCode)) {
      setError('Enter a valid 6-character room code')
      return
    }

    const normalized = normalizeRoomCode(joinCode)
    const result = await joinRoom(
      normalized,
      displayName.trim() || 'Guest',
      showJoinPassword ? joinPassword : undefined,
    )

    if (result.ok) {
      navigate(`/room/${normalized}`)
      return
    }

    if (result.error === 'password_required') {
      setShowJoinPassword(true)
      setError('This room requires a password')
      return
    }

    if (result.error === 'incorrect_password') {
      setShowJoinPassword(true)
      setError('Incorrect password. Try again.')
      return
    }

    setError('Could not join room. Check the code or try again.')
  }

  const handleCodeChange = (value: string) => {
    setJoinCode(formatJoinCode(value))
    setError('')
    setShowJoinPassword(false)
    setJoinPassword('')
  }

  return (
    <div
      className="animate-fade-up w-full max-w-md rounded-2xl border p-1 sm:max-w-lg"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
        {(['create', 'join'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => {
              setTab(item)
              setError('')
            }}
            className="relative flex-1 px-4 py-3.5 text-sm font-medium transition-colors sm:py-4 sm:text-base"
            style={{
              color: tab === item ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {item === 'create' ? 'Create room' : 'Join room'}
            {tab === item && (
              <span className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full bg-accent" />
            )}
          </button>
        ))}
      </div>

      <div className="p-5 sm:p-7">
        {tab === 'create' ? (
          <div className="space-y-5">
            <p className="text-sm leading-relaxed sm:text-[15px]" style={{ color: 'var(--text-secondary)' }}>
              You&apos;ll get a room code and QR others can join with. Start a video meeting inside the room anytime.
            </p>

            {!showCreatePassword ? (
              <button
                type="button"
                onClick={() => setShowCreatePassword(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
              >
                <Lock className="h-3.5 w-3.5" />
                Add optional password
              </button>
            ) : (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    Room password (optional)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreatePassword(false)
                      setCreatePassword('')
                    }}
                    className="text-xs hover:underline"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Remove
                  </button>
                </div>
                <input
                  type="password"
                  value={createPassword}
                  onChange={(e) => {
                    setCreatePassword(e.target.value)
                    setError('')
                  }}
                  placeholder="Min. 4 characters"
                  maxLength={64}
                  autoComplete="new-password"
                  className="w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-accent"
                  style={{
                    background: 'var(--input-bg)',
                    borderColor: 'var(--border-strong)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
            )}

            {error && tab === 'create' && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="button"
              onClick={() => {
                void handleCreate()
              }}
              disabled={isLoading}
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3.5 text-sm font-semibold text-[#0b0e11] transition-all hover:bg-accent-hover active:scale-[0.98] disabled:opacity-70 sm:py-4 sm:text-base"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  Create a room
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void handleJoin(e)} className="space-y-5">
            <p className="text-sm leading-relaxed sm:text-[15px]" style={{ color: 'var(--text-secondary)' }}>
              Enter the 6-character code from someone else&apos;s room.
            </p>

            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                Display name (optional)
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                maxLength={32}
                className="mb-3 w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-accent"
                style={{
                  background: 'var(--input-bg)',
                  borderColor: 'var(--border-strong)',
                  color: 'var(--text-primary)',
                }}
              />

              <input
                type="text"
                value={joinCode}
                onChange={(e) => handleCodeChange(e.target.value)}
                placeholder="ABC-XYZ"
                maxLength={7}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl border px-4 py-3.5 text-center font-mono text-lg tracking-[0.35em] uppercase outline-none transition focus:border-accent sm:py-4 sm:text-xl"
                style={{
                  background: 'var(--input-bg)',
                  borderColor: error ? '#f87171' : 'var(--border-strong)',
                  color: 'var(--text-primary)',
                }}
              />

              {showJoinPassword && (
                <div className="mt-3">
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    Room password
                  </label>
                  <input
                    type="password"
                    value={joinPassword}
                    onChange={(e) => {
                      setJoinPassword(e.target.value)
                      setError('')
                    }}
                    placeholder="Enter room password"
                    maxLength={64}
                    autoComplete="current-password"
                    autoFocus
                    className="w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-accent"
                    style={{
                      background: 'var(--input-bg)',
                      borderColor: error ? '#f87171' : 'var(--border-strong)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
              )}

              {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3.5 text-sm font-semibold text-[#0b0e11] transition-all hover:bg-accent-hover active:scale-[0.98] disabled:opacity-70 sm:py-4 sm:text-base"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Joining...
                </>
              ) : (
                <>
                  Join room
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
