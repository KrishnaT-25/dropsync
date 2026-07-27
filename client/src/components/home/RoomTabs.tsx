import { ArrowRight, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRoom } from '../../context/RoomContext'
import { isValidRoomCode, normalizeRoomCode } from '../../utils/roomCode'

type Tab = 'create' | 'join'

export function RoomTabs() {
  const [tab, setTab] = useState<Tab>('create')
  const [joinCode, setJoinCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { createRoom, joinRoom, isLoading } = useRoom()

  const handleCreate = async () => {
    setError('')
    try {
      const code = await createRoom()
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
    const success = await joinRoom(normalized, displayName.trim() || 'Guest')
    if (success) {
      navigate(`/room/${normalized}`)
    } else {
      setError('Could not join room. Check the code or try again.')
    }
  }

  const handleCodeChange = (value: string) => {
    const cleaned = normalizeRoomCode(value)
    if (cleaned.length <= 3) {
      setJoinCode(cleaned)
    } else {
      setJoinCode(`${cleaned.slice(0, 3)}-${cleaned.slice(3)}`)
    }
    setError('')
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
          <div className="space-y-6">
            <p className="text-sm leading-relaxed sm:text-[15px]" style={{ color: 'var(--text-secondary)' }}>
              You&apos;ll get a room code and QR others can join with. Start a video meeting inside the room anytime.
            </p>
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
