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
import * as api from '../services/api'
import * as socket from '../services/socket'
import type { ActivityItem, ConnectionStatus, Participant, RoomState } from '../types'
import { applyRoomState, mapApiRoom, mergeActivity } from '../utils/roomMapper'

const STORAGE_KEY = 'dropsync-session'

interface StoredSession {
  code: string
  participantId: string
  expiresAt: string
}

interface RoomContextValue {
  room: RoomState | null
  participantId: string | null
  connection: ConnectionStatus
  isLoading: boolean
  createRoom: () => Promise<string>
  joinRoom: (code: string, displayName?: string) => Promise<boolean>
  leaveRoom: () => void
  sendMessage: (content: string) => void
  sendClipboard: (content: string) => void
  sendCodeSnippet: (content: string) => void
  sendFile: (file: File) => void
  addSystemActivity: (content: string) => void
  restoreRoom: (code: string) => Promise<boolean>
  updateParticipantMeetingState: (
    participantId: string,
    patch: Partial<Pick<Participant, 'inMeeting' | 'isMuted' | 'isCameraOff' | 'isScreenSharing'>>,
  ) => void
}

const RoomContext = createContext<RoomContextValue | null>(null)

function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

function saveSession(session: StoredSession | null) {
  if (session) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } else {
    sessionStorage.removeItem(STORAGE_KEY)
  }
}

function detectLink(content: string): ActivityItem['type'] {
  return /^https?:\/\//i.test(content) ? 'link' : 'message'
}

export function RoomProvider({ children }: { children: ReactNode }) {
  const [room, setRoom] = useState<RoomState | null>(null)
  const [participantId, setParticipantId] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus>({ connected: false, error: null })
  const [isLoading, setIsLoading] = useState(false)

  const participantIdRef = useRef<string | null>(null)
  const roomCodeRef = useRef<string | null>(null)

  useEffect(() => {
    participantIdRef.current = participantId
  }, [participantId])

  useEffect(() => {
    roomCodeRef.current = room?.code ?? null
  }, [room?.code])

  const connectToRoom = useCallback(async (code: string, pid: string, mappedRoom: RoomState) => {
    setRoom(mappedRoom)
    setParticipantId(pid)
    saveSession({
      code,
      participantId: pid,
      expiresAt: mappedRoom.expiresAt.toISOString(),
    })

    const ack = await socket.joinRoomSocket(code, pid)
    if (!ack.ok || !ack.room) {
      setConnection({ connected: false, error: ack.error ?? 'Could not connect to room' })
      return false
    }

    setRoom(applyRoomState(mappedRoom, ack.room, pid))
    setConnection({ connected: true, error: null })
    return true
  }, [])

  useEffect(() => {
    const handleRoomState = (apiRoom: Parameters<typeof applyRoomState>[1]) => {
      const pid = participantIdRef.current
      if (!pid) return
      setRoom((prev) => applyRoomState(prev, apiRoom, pid))
    }

    const handleActivity = (activity: ActivityItem & { timestamp: string }) => {
      const pid = participantIdRef.current
      if (!pid) return

      const mapped: ActivityItem = {
        ...activity,
        timestamp: new Date(activity.timestamp),
      }

      setRoom((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          activities: mergeActivity(prev.activities, mapped),
        }
      })
    }

    const handleExpired = () => {
      setRoom(null)
      setParticipantId(null)
      saveSession(null)
      socket.disconnectSocket()
      setConnection({ connected: false, error: 'Room expired' })
    }

    const handleConnect = () => {
      setConnection((prev) => ({ ...prev, connected: true, error: null }))
    }

    const handleDisconnect = () => {
      setConnection((prev) => ({ ...prev, connected: false }))
    }

    socket.onRoomState(handleRoomState)
    socket.onActivity(handleActivity)
    socket.onRoomExpired(handleExpired)
    socket.onSocketConnect(handleConnect)
    socket.onSocketDisconnect(handleDisconnect)

    return () => {
      socket.offRoomState(handleRoomState)
      socket.offActivity(handleActivity)
      socket.offRoomExpired(handleExpired)
      socket.offSocketConnect(handleConnect)
      socket.offSocketDisconnect(handleDisconnect)
    }
  }, [])

  const createRoom = useCallback(async () => {
    setIsLoading(true)
    setConnection({ connected: false, error: null })
    try {
      const { room: apiRoom, participantId: pid } = await api.createRoom()
      const mapped = mapApiRoom(apiRoom, pid)
      await connectToRoom(apiRoom.code, pid, mapped)
      return apiRoom.code
    } catch (error) {
      setConnection({
        connected: false,
        error: error instanceof Error ? error.message : 'Failed to create room',
      })
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [connectToRoom])

  const joinRoom = useCallback(
    async (code: string, displayName = 'Guest') => {
      setIsLoading(true)
      setConnection({ connected: false, error: null })
      try {
        const normalized = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
        const { room: apiRoom, participantId: pid } = await api.joinRoom(normalized, displayName)
        const mapped = mapApiRoom(apiRoom, pid)
        mapped.participants = mapped.participants.map((p) =>
          p.id === pid ? { ...p, name: displayName, isYou: true } : p,
        )
        await connectToRoom(normalized, pid, mapped)
        return true
      } catch (error) {
        setConnection({
          connected: false,
          error: error instanceof Error ? error.message : 'Failed to join room',
        })
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [connectToRoom],
  )

  const leaveRoom = useCallback(() => {
    socket.emitLeaveRoom()
    socket.disconnectSocket()
    setRoom(null)
    setParticipantId(null)
    saveSession(null)
    setConnection({ connected: false, error: null })
  }, [])

  const restoreRoom = useCallback(
    async (code: string) => {
      const normalized = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
      if (room?.code === normalized && participantId) return true

      const stored = loadSession()
      if (stored?.code === normalized) {
        setIsLoading(true)
        try {
          const { room: apiRoom } = await api.getRoom(normalized)
          const mapped = mapApiRoom(apiRoom, stored.participantId)
          await connectToRoom(normalized, stored.participantId, mapped)
          return true
        } catch {
          saveSession(null)
          return false
        } finally {
          setIsLoading(false)
        }
      }

      return false
    },
    [room?.code, participantId, connectToRoom],
  )

  const broadcastActivity = useCallback(
    (type: ActivityItem['type'], content: string, fileMeta?: ActivityItem['fileMeta']) => {
      const trimmed = content.trim()
      if (!trimmed) return

      if (connection.connected) {
        socket.emitActivity({
          type,
          content: trimmed,
          fileMeta: fileMeta
            ? {
                fileName: fileMeta.fileName,
                fileSize: fileMeta.fileSize,
                mimeType: fileMeta.mimeType,
              }
            : undefined,
        })

        if (fileMeta?.objectUrl) {
          setRoom((prev) => {
            if (!prev) return prev
            const localActivity: ActivityItem = {
              id: crypto.randomUUID(),
              type,
              content: trimmed,
              sender: 'You',
              senderId: participantId ?? undefined,
              timestamp: new Date(),
              fileMeta,
            }
            return {
              ...prev,
              activities: [...prev.activities, localActivity],
            }
          })
        }
        return
      }

      const localActivity: ActivityItem = {
        id: crypto.randomUUID(),
        type,
        content: trimmed,
        sender: 'You',
        senderId: participantId ?? undefined,
        timestamp: new Date(),
        fileMeta,
      }

      setRoom((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          activities: [...prev.activities, localActivity],
        }
      })
    },
    [connection.connected, participantId],
  )

  const sendMessage = useCallback(
    (content: string) => {
      broadcastActivity(detectLink(content), content)
    },
    [broadcastActivity],
  )

  const sendClipboard = useCallback(
    (content: string) => {
      broadcastActivity('clipboard', content)
    },
    [broadcastActivity],
  )

  const sendCodeSnippet = useCallback(
    (content: string) => {
      broadcastActivity('code', content)
    },
    [broadcastActivity],
  )

  const sendFile = useCallback(
    (file: File) => {
      const objectUrl = URL.createObjectURL(file)
      broadcastActivity('file', file.name, {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        objectUrl,
      })
    },
    [broadcastActivity],
  )

  const addSystemActivity = useCallback(
    (content: string) => {
      if (connection.connected) {
        socket.emitSystemActivity(content)
        return
      }

      setRoom((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          activities: [
            ...prev.activities,
            {
              id: crypto.randomUUID(),
              type: 'meeting',
              content,
              sender: 'You',
              timestamp: new Date(),
            },
          ],
        }
      })
    },
    [connection.connected],
  )

  const updateParticipantMeetingState = useCallback(
    (
      targetId: string,
      patch: Partial<Pick<Participant, 'inMeeting' | 'isMuted' | 'isCameraOff' | 'isScreenSharing'>>,
    ) => {
      setRoom((prev) => {
        if (!prev) return prev

        const participants = prev.participants.map((participant) =>
          participant.id === targetId ? { ...participant, ...patch } : participant,
        )

        return {
          ...prev,
          participants,
          meetingActive: participants.some((p) => p.inMeeting),
        }
      })

      if (targetId === participantIdRef.current && connection.connected) {
        socket.emitMeetingState(patch)
      }
    },
    [connection.connected],
  )

  const value = useMemo(
    () => ({
      room,
      participantId,
      connection,
      isLoading,
      createRoom,
      joinRoom,
      leaveRoom,
      sendMessage,
      sendClipboard,
      sendCodeSnippet,
      sendFile,
      addSystemActivity,
      restoreRoom,
      updateParticipantMeetingState,
    }),
    [
      room,
      participantId,
      connection,
      isLoading,
      createRoom,
      joinRoom,
      leaveRoom,
      sendMessage,
      sendClipboard,
      sendCodeSnippet,
      sendFile,
      addSystemActivity,
      restoreRoom,
      updateParticipantMeetingState,
    ],
  )

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>
}

export function useRoom() {
  const ctx = useContext(RoomContext)
  if (!ctx) throw new Error('useRoom must be used within RoomProvider')
  return ctx
}
