import { ArrowRight, Loader2, Video } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as meetingApi from '../../services/meetingApi'
import {
  formatMeetingCode,
  isValidMeetingCode,
  parseMeetingCodeInput,
} from '../../utils/meetingCode'

type Tab = 'start' | 'join'

const STORAGE_KEY = 'dropsync-meeting-session'

export function VideoCallTabs() {
  const [tab, setTab] = useState<Tab>('start')
  const [joinInput, setJoinInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleStart = async () => {
    setError('')
    setLoading(true)
    try {
      const { meeting, participantId } = await meetingApi.createMeeting()
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          code: meeting.code,
          participantId,
          isHost: true,
        }),
      )
      navigate(`/meet/${meeting.code}`)
    } catch {
      setError('Could not start a video call. Is the server running?')
    } finally {
      setLoading(false)
    }
  }

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const code = parseMeetingCodeInput(joinInput)
    if (!isValidMeetingCode(code)) {
      setError('Enter a valid meeting link or 6-character code')
      return
    }
    sessionStorage.removeItem(STORAGE_KEY)
    navigate(`/meet/${code}`)
  }

  return (
    <div
      className="animate-fade-up mt-6 w-full max-w-md rounded-2xl border p-1 sm:max-w-lg"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div className="flex items-center gap-2 border-b px-4 pt-3 pb-2" style={{ borderColor: 'var(--border)' }}>
        <Video className="h-4 w-4 text-accent" />
        <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
          Video call
        </p>
      </div>

      <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
        {(['start', 'join'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => {
              setTab(item)
              setError('')
            }}
            className="flex-1 px-4 py-3 text-sm font-semibold transition"
            style={{
              color: tab === item ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: tab === item ? 'inset 0 -2px 0 var(--accent)' : undefined,
            }}
          >
            {item === 'start' ? 'Start a video call' : 'Join a video call'}
          </button>
        ))}
      </div>

      <div className="p-5 sm:p-6">
        {tab === 'start' ? (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Create a meeting link, set your name, and invite others — separate from file-share rooms.
            </p>
            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-[#0b0e11] transition hover:bg-accent-hover disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
              Start a video call
            </button>
          </div>
        ) : (
          <form onSubmit={handleJoin} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                Meeting link or code
              </span>
              <input
                value={joinInput}
                onChange={(e) => {
                  const v = e.target.value
                  setJoinInput(v.includes('/') || v.includes('?') ? v : formatMeetingCode(v))
                  setError('')
                }}
                placeholder="Paste link or ABC-DEF"
                className="w-full rounded-xl border px-3 py-2.5 font-mono text-sm outline-none focus:border-accent"
                style={{
                  background: 'var(--bg-elevated)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
              />
            </label>
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-[#0b0e11] transition hover:bg-accent-hover"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  )
}
