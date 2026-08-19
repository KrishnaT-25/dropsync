import { ArrowRight, Loader2, Lock, Video } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRoom } from '../../context/RoomContext'
import * as meetingApi from '../../services/meetingApi'
import {
  formatMeetingCode,
  isValidMeetingCode,
  parseMeetingCodeInput,
} from '../../utils/meetingCode'
import { isValidRoomCode, normalizeRoomCode } from '../../utils/roomCode'

type Tab = 'create-room' | 'join-room' | 'start-meet' | 'join-meet'

const MEETING_STORAGE_KEY = 'dropsync-meeting-session'

const TABS: { id: Tab; label: string }[] = [
  { id: 'create-room', label: 'Create room' },
  { id: 'join-room', label: 'Join room' },
  { id: 'start-meet', label: 'Start meet' },
  { id: 'join-meet', label: 'Join meet' },
]

function formatJoinCode(value: string): string {
  const cleaned = normalizeRoomCode(value)
  if (cleaned.length <= 3) return cleaned
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`
}

export function EntryTabs() {
  const [tab, setTab] = useState<Tab>('create-room')
  const [joinCode, setJoinCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [showCreatePassword, setShowCreatePassword] = useState(false)
  const [joinPassword, setJoinPassword] = useState('')
  const [showJoinPassword, setShowJoinPassword] = useState(false)
  const [meetInput, setMeetInput] = useState('')
  const [error, setError] = useState('')
  const [meetLoading, setMeetLoading] = useState(false)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { createRoom, joinRoom, isLoading } = useRoom()

  useEffect(() => {
    const meetPreset = searchParams.get('meetCode') ?? searchParams.get('meet')
    if (meetPreset && isValidMeetingCode(meetPreset)) {
      setTab('join-meet')
      setMeetInput(formatMeetingCode(meetPreset))
      return
    }

    const presetCode = searchParams.get('joinCode') ?? searchParams.get('join')
    const needPassword = searchParams.get('needPassword') === '1'
    if (presetCode && isValidRoomCode(presetCode)) {
      setTab('join-room')
      setJoinCode(formatJoinCode(presetCode))
      if (needPassword) {
        setShowJoinPassword(true)
        setError('This room requires a password')
      }
    }
  }, [searchParams])

  const switchTab = (next: Tab) => {
    setTab(next)
    setError('')
  }

  const handleCreateRoom = async () => {
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

  const handleJoinRoom = async (e: React.FormEvent) => {
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

  const handleStartMeet = async () => {
    setError('')
    setMeetLoading(true)
    try {
      const { meeting, participantId } = await meetingApi.createMeeting()
      sessionStorage.setItem(
        MEETING_STORAGE_KEY,
        JSON.stringify({
          code: meeting.code,
          participantId,
          isHost: true,
        }),
      )
      navigate(`/meet/${meeting.code}`)
    } catch {
      setError('Could not start a meeting. Is the server running?')
    } finally {
      setMeetLoading(false)
    }
  }

  const handleJoinMeet = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const code = parseMeetingCodeInput(meetInput)
    if (!isValidMeetingCode(code)) {
      setError('Enter a valid meeting link or 6-character code')
      return
    }
    sessionStorage.removeItem(MEETING_STORAGE_KEY)
    navigate(`/meet/${code}`)
  }

  const ctaClass =
    'group flex w-full items-center justify-center gap-2 rounded-full bg-accent px-6 py-3.5 text-sm font-semibold text-[#0b0e11] transition-all hover:bg-accent-hover active:scale-[0.98] disabled:opacity-70 sm:py-4 sm:text-base'

  const fieldClass =
    'w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-accent'

  const fieldStyle = (invalid?: boolean) => ({
    background: 'var(--input-bg)',
    borderColor: invalid ? '#f87171' : 'var(--border-strong)',
    color: 'var(--text-primary)',
  })

  return (
    <div
      className="animate-fade-up w-full max-w-md rounded-2xl border p-2 sm:max-w-lg sm:p-2.5"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Segmented control — matches unified room + meet entry */}
      <div
        className="grid grid-cols-2 gap-1 rounded-xl p-1 sm:grid-cols-4"
        style={{ background: 'var(--bg-elevated)' }}
      >
        {TABS.map(({ id, label }) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => switchTab(id)}
              className="rounded-lg px-2 py-2.5 text-[11px] font-medium transition-all sm:px-3 sm:text-sm"
              style={{
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                background: active ? 'var(--bg-card)' : 'transparent',
                boxShadow: active ? 'var(--shadow-card)' : undefined,
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="p-4 sm:p-6">
        {tab === 'create-room' && (
          <div className="space-y-5">
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Get a room code and QR others can join. Share files, text, and links — start a meet from inside anytime.
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
                <label
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Room password
                </label>
                <div className="mb-1.5 flex justify-end">
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
                  className={fieldClass}
                  style={fieldStyle()}
                />
              </div>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="button"
              onClick={() => void handleCreateRoom()}
              disabled={isLoading}
              className={ctaClass}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  Create room
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </div>
        )}

        {tab === 'join-room' && (
          <form onSubmit={(e) => void handleJoinRoom(e)} className="space-y-5">
            <div>
              <label
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: 'var(--text-muted)' }}
              >
                Display name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name (optional)"
                maxLength={32}
                className={`${fieldClass} mb-4`}
                style={fieldStyle()}
              />

              <label
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: 'var(--text-muted)' }}
              >
                Room code
              </label>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => {
                  setJoinCode(formatJoinCode(e.target.value))
                  setError('')
                  setShowJoinPassword(false)
                  setJoinPassword('')
                }}
                placeholder="ABC-XYZ"
                maxLength={7}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl border px-4 py-3.5 text-center font-mono text-lg tracking-[0.35em] uppercase outline-none transition focus:border-accent sm:py-4 sm:text-xl"
                style={fieldStyle(Boolean(error))}
              />

              {showJoinPassword && (
                <div className="mt-4">
                  <label
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em]"
                    style={{ color: 'var(--text-muted)' }}
                  >
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
                    className={fieldClass}
                    style={fieldStyle(Boolean(error))}
                  />
                </div>
              )}

              {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
            </div>

            <button type="submit" disabled={isLoading} className={ctaClass}>
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

        {tab === 'start-meet' && (
          <div className="space-y-5">
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Start a standalone video call with camera, mic, and screen share — separate from file-share rooms.
            </p>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="button"
              onClick={() => void handleStartMeet()}
              disabled={meetLoading}
              className={ctaClass}
            >
              {meetLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Video className="h-4 w-4" />
                  Start meet
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </div>
        )}

        {tab === 'join-meet' && (
          <form onSubmit={handleJoinMeet} className="space-y-5">
            <div>
              <label
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: 'var(--text-muted)' }}
              >
                Meeting code
              </label>
              <input
                value={meetInput}
                onChange={(e) => {
                  const v = e.target.value
                  setMeetInput(v.includes('/') || v.includes('?') ? v : formatMeetingCode(v))
                  setError('')
                }}
                placeholder="Paste link or ABC-DEF"
                className="w-full rounded-xl border px-4 py-3.5 text-center font-mono text-lg tracking-[0.2em] outline-none transition focus:border-accent sm:py-4 sm:text-xl"
                style={fieldStyle(Boolean(error))}
              />
              {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
            </div>

            <button type="submit" className={ctaClass}>
              Join meet
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
