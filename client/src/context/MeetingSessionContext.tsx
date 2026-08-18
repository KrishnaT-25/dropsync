import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import * as meetingApi from '../services/meetingApi'
import * as meetingSocket from '../services/meetingSocket'
import type {
  ApiMeetingRecord,
  ConnectionStatus,
  MeetingExitReason,
  MeetingParticipant,
  MeetingSessionState,
} from '../types'
import { normalizeMeetingCode } from '../utils/meetingCode'

interface MeetingSessionContextValue {
  meeting: MeetingSessionState | null
  participantId: string | null
  isHost: boolean
  isJoined: boolean
  connection: ConnectionStatus
  exitReason: MeetingExitReason
  activityLog: Array<{ actorId: string; actorName: string; content: string; id: string }>
  prepareAsHost: (code: string, participantId: string) => void
  joinAsGuest: (code: string, displayName: string) => Promise<{ ok: boolean; error?: string }>
  enterCall: (displayName: string) => Promise<{ ok: boolean; error?: string }>
  leaveCall: () => void
  endCallForEveryone: () => void
  hostMute: (targetParticipantId: string) => void
  hostRemove: (targetParticipantId: string) => void
  emitMediaState: (patch: {
    isMuted?: boolean
    isCameraOff?: boolean
    isScreenSharing?: boolean
  }) => void
  emitActivity: (content: string) => void
  clearExit: () => void
  hydrateFromStorage: (code: string) => boolean
}

const MeetingSessionContext = createContext<MeetingSessionContextValue | null>(null)

const STORAGE_KEY = 'dropsync-meeting-session'

interface StoredMeetingSession {
  code: string
  participantId: string
  isHost: boolean
}

function loadStored(): StoredMeetingSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredMeetingSession
  } catch {
    return null
  }
}

function saveStored(session: StoredMeetingSession | null) {
  if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  else sessionStorage.removeItem(STORAGE_KEY)
}

function mapMeeting(api: ApiMeetingRecord, selfId: string | null): MeetingSessionState {
  return {
    code: api.code,
    hostParticipantId: api.hostParticipantId,
    createdAt: api.createdAt,
    expiresAt: api.expiresAt,
    participants: api.participants.map((p) => ({
      ...p,
      isYou: p.id === selfId,
    })),
  }
}

export function MeetingSessionProvider({ children }: { children: ReactNode }) {
  const [meeting, setMeeting] = useState<MeetingSessionState | null>(null)
  const [participantId, setParticipantId] = useState<string | null>(null)
  const [isJoined, setIsJoined] = useState(false)
  const [connection, setConnection] = useState<ConnectionStatus>({ connected: false, error: null })
  const [exitReason, setExitReason] = useState<MeetingExitReason>(null)
  const [activityLog, setActivityLog] = useState<
    Array<{ actorId: string; actorName: string; content: string; id: string }>
  >([])

  const participantIdRef = useRef<string | null>(null)
  const isHostRef = useRef(false)

  useEffect(() => {
    participantIdRef.current = participantId
  }, [participantId])

  const isHost = Boolean(
    meeting && participantId && meeting.hostParticipantId === participantId,
  )
  isHostRef.current = isHost

  const applyMeeting = useCallback((api: ApiMeetingRecord, selfId: string | null) => {
    setMeeting(mapMeeting(api, selfId))
  }, [])

  useEffect(() => {
    const handleState = (api: ApiMeetingRecord) => {
      applyMeeting(api, participantIdRef.current)
      setConnection({ connected: true, error: null })
    }

    const handlePeerJoined = (payload: {
      participant: MeetingParticipant | null
      meeting: ApiMeetingRecord
    }) => {
      applyMeeting(payload.meeting, participantIdRef.current)
    }

    const handlePeerLeft = (payload: { participantId: string; meeting: ApiMeetingRecord }) => {
      applyMeeting(payload.meeting, participantIdRef.current)
    }

    const handleActivity = (payload: { actorId: string; actorName: string; content: string }) => {
      setActivityLog((prev) => [
        ...prev,
        { ...payload, id: crypto.randomUUID() },
      ])
    }

    const handleForceMuted = (payload: { targetParticipantId: string }) => {
      if (payload.targetParticipantId === participantIdRef.current) {
        window.dispatchEvent(new CustomEvent('dropsync-force-mute'))
      }
    }

    const handleRemoved = () => {
      setIsJoined(false)
      setMeeting(null)
      setParticipantId(null)
      saveStored(null)
      setExitReason('removed')
      setConnection({ connected: false, error: null })
    }

    const handleEnded = (payload: { reason: 'host_ended' | 'host_left' }) => {
      setIsJoined(false)
      setMeeting(null)
      setParticipantId(null)
      saveStored(null)
      setExitReason(payload.reason)
      setConnection({ connected: false, error: null })
    }

    meetingSocket.onMeetingState(handleState)
    meetingSocket.onPeerJoined(handlePeerJoined)
    meetingSocket.onPeerLeft(handlePeerLeft)
    meetingSocket.onMeetingActivity(handleActivity)
    meetingSocket.onForceMuted(handleForceMuted)
    meetingSocket.onRemovedByHost(handleRemoved)
    meetingSocket.onMeetingEnded(handleEnded)

    return () => {
      meetingSocket.offMeetingState(handleState)
      meetingSocket.offPeerJoined(handlePeerJoined)
      meetingSocket.offPeerLeft(handlePeerLeft)
      meetingSocket.offMeetingActivity(handleActivity)
      meetingSocket.offForceMuted(handleForceMuted)
      meetingSocket.offRemovedByHost(handleRemoved)
      meetingSocket.offMeetingEnded(handleEnded)
    }
  }, [applyMeeting])

  const prepareAsHost = useCallback((code: string, pid: string) => {
    const normalized = normalizeMeetingCode(code)
    setParticipantId(pid)
    setIsJoined(false)
    setExitReason(null)
    setActivityLog([])
    setMeeting({
      code: normalized,
      hostParticipantId: pid,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      participants: [
        {
          id: pid,
          name: 'Host',
          isHost: true,
          isMuted: false,
          isCameraOff: false,
          isScreenSharing: false,
          isYou: true,
        },
      ],
    })
    saveStored({ code: normalized, participantId: pid, isHost: true })
    setConnection({ connected: false, error: null })
  }, [])

  const joinAsGuest = useCallback(
    async (code: string, displayName: string): Promise<{ ok: boolean; error?: string }> => {
      const normalized = normalizeMeetingCode(code)
      try {
        const { meeting: apiMeeting, participantId: pid } = await meetingApi.joinMeeting(
          normalized,
          displayName.trim() || 'Guest',
        )
        setParticipantId(pid)
        applyMeeting(apiMeeting, pid)
        saveStored({ code: normalized, participantId: pid, isHost: false })
        setExitReason(null)
        setActivityLog([])
        setIsJoined(false)
        return { ok: true }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Could not join meeting',
        }
      }
    },
    [applyMeeting],
  )

  const enterCall = useCallback(
    async (displayName: string): Promise<{ ok: boolean; error?: string }> => {
      const stored = loadStored()
      const code = meeting?.code ?? stored?.code
      const pid = participantId ?? stored?.participantId
      if (!code || !pid) {
        return { ok: false, error: 'Missing meeting session' }
      }

      const name = displayName.trim() || 'Guest'
      const ack = await meetingSocket.joinMeetingSocket(code, pid, name)
      if (!ack.ok || !ack.meeting) {
        setConnection({ connected: false, error: ack.error ?? 'Could not join meeting' })
        return { ok: false, error: ack.error ?? 'Could not join meeting' }
      }

      applyMeeting(ack.meeting, pid)
      setParticipantId(pid)
      setIsJoined(true)
      setConnection({ connected: true, error: null })
      setExitReason(null)
      saveStored({
        code,
        participantId: pid,
        isHost: ack.meeting.hostParticipantId === pid,
      })
      meetingSocket.emitMeetingActivity('joined the call')
      return { ok: true }
    },
    [applyMeeting, meeting?.code, participantId],
  )

  const leaveCall = useCallback(() => {
    if (isHostRef.current) {
      meetingSocket.emitHostEnd()
      setExitReason('host_ended')
    } else {
      meetingSocket.emitLeaveMeeting()
      setExitReason('left')
    }
    setIsJoined(false)
    setMeeting(null)
    setParticipantId(null)
    saveStored(null)
    setConnection({ connected: false, error: null })
  }, [])

  const endCallForEveryone = useCallback(() => {
    meetingSocket.emitHostEnd()
    setIsJoined(false)
    setMeeting(null)
    setParticipantId(null)
    saveStored(null)
    setExitReason('host_ended')
    setConnection({ connected: false, error: null })
  }, [])

  const hostMute = useCallback((targetParticipantId: string) => {
    meetingSocket.emitHostMute(targetParticipantId)
  }, [])

  const hostRemove = useCallback((targetParticipantId: string) => {
    meetingSocket.emitHostRemove(targetParticipantId)
  }, [])

  const emitMediaState = useCallback(
    (patch: { isMuted?: boolean; isCameraOff?: boolean; isScreenSharing?: boolean }) => {
      if (!isJoined) return
      meetingSocket.emitMeetingMediaState(patch)
    },
    [isJoined],
  )

  const emitActivity = useCallback(
    (content: string) => {
      if (!isJoined) return
      meetingSocket.emitMeetingActivity(content)
    },
    [isJoined],
  )

  const clearExit = useCallback(() => setExitReason(null), [])

  const hydrateFromStorage = useCallback(
    (code: string): boolean => {
      const stored = loadStored()
      const normalized = normalizeMeetingCode(code)
      if (!stored || stored.code !== normalized) return false
      setParticipantId(stored.participantId)
      setIsJoined(false)
      setExitReason(null)
      setMeeting({
        code: normalized,
        hostParticipantId: stored.isHost ? stored.participantId : '',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        participants: stored.isHost
          ? [
              {
                id: stored.participantId,
                name: 'Host',
                isHost: true,
                isMuted: false,
                isCameraOff: false,
                isScreenSharing: false,
                isYou: true,
              },
            ]
          : [],
      })
      setConnection({ connected: false, error: null })
      return true
    },
    [],
  )

  const value = useMemo(
    () => ({
      meeting,
      participantId,
      isHost,
      isJoined,
      connection,
      exitReason,
      activityLog,
      prepareAsHost,
      joinAsGuest,
      enterCall,
      leaveCall,
      endCallForEveryone,
      hostMute,
      hostRemove,
      emitMediaState,
      emitActivity,
      clearExit,
      hydrateFromStorage,
    }),
    [
      meeting,
      participantId,
      isHost,
      isJoined,
      connection,
      exitReason,
      activityLog,
      prepareAsHost,
      joinAsGuest,
      enterCall,
      leaveCall,
      endCallForEveryone,
      hostMute,
      hostRemove,
      emitMediaState,
      emitActivity,
      clearExit,
      hydrateFromStorage,
    ],
  )

  return (
    <MeetingSessionContext.Provider value={value}>{children}</MeetingSessionContext.Provider>
  )
}

export function useMeetingSession() {
  const ctx = useContext(MeetingSessionContext)
  if (!ctx) throw new Error('useMeetingSession must be used within MeetingSessionProvider')
  return ctx
}
