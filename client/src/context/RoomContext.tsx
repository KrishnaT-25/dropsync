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
import { ApiRequestError } from '../services/api'
import { fileTransferManager } from '../services/fileTransfer'
import * as socket from '../services/socket'
import type { ActivityItem, ConnectionStatus, JoinRoomResult, Participant, RoomState } from '../types'
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
  createRoom: (password?: string) => Promise<string>
  joinRoom: (code: string, displayName?: string, password?: string) => Promise<JoinRoomResult>
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
  const roomRef = useRef<RoomState | null>(null)
  const pendingFilesRef = useRef(new Map<string, File>())
  const knownPeersRef = useRef(new Set<string>())

  useEffect(() => {
    participantIdRef.current = participantId
  }, [participantId])

  useEffect(() => {
    roomCodeRef.current = room?.code ?? null
    roomRef.current = room
  }, [room])

  const patchFileActivity = useCallback(
    (
      match: { transferId?: string; activityId?: string },
      patch: Partial<NonNullable<ActivityItem['fileMeta']>>,
    ) => {
      setRoom((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          activities: prev.activities.map((a) => {
            if (a.type !== 'file' || !a.fileMeta) return a
            const byTransfer =
              match.transferId && a.fileMeta.transferId === match.transferId
            const byActivity = match.activityId && a.id === match.activityId
            if (!byTransfer && !byActivity) return a
            return {
              ...a,
              fileMeta: {
                ...a.fileMeta,
                ...patch,
              },
            }
          }),
        }
      })
    },
    [],
  )

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

    const next = applyRoomState(mappedRoom, ack.room, pid)
    setRoom(next)
    setConnection({ connected: true, error: null })

    knownPeersRef.current = new Set(next.participants.map((p) => p.id))
    fileTransferManager.configure({
      selfId: pid,
      socket: socket.getSocket(),
      onProgress: (update) => {
        patchFileActivity(
          { transferId: update.transferId, activityId: update.activityId || undefined },
          {
            progress: update.progress,
            status: update.status,
            transferPath: update.transferPath,
            objectUrl: update.objectUrl,
            downloadUrl: update.downloadUrl,
          },
        )
      },
    })

    return true
  }, [patchFileActivity])

  useEffect(() => {
    const handleRoomState = (apiRoom: Parameters<typeof applyRoomState>[1]) => {
      const pid = participantIdRef.current
      if (!pid) return
      setRoom((prev) => {
        const next = applyRoomState(prev, apiRoom, pid)
        const nextIds = new Set(next.participants.map((p) => p.id))
        for (const id of knownPeersRef.current) {
          if (!nextIds.has(id) && id !== pid) {
            fileTransferManager.handlePeerLeft(id)
          }
        }
        knownPeersRef.current = nextIds
        return next
      })
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

      const transferId = mapped.fileMeta?.transferId
      if (
        mapped.type === 'file' &&
        transferId &&
        mapped.senderId === pid &&
        pendingFilesRef.current.has(transferId)
      ) {
        const file = pendingFilesRef.current.get(transferId)!
        pendingFilesRef.current.delete(transferId)
        const recipients =
          roomRef.current?.participants.filter((p) => p.id !== pid).map((p) => p.id) ?? []
        void fileTransferManager.sendFileToPeers({
          file,
          transferId,
          activityId: mapped.id,
          recipientIds: recipients,
        })
      }
    }

    const handleExpired = () => {
      setRoom(null)
      setParticipantId(null)
      saveSession(null)
      fileTransferManager.dispose()
      socket.disconnectSocket()
      setConnection({ connected: false, error: 'Room expired' })
    }

    const handleConnect = () => {
      setConnection((prev) => ({ ...prev, connected: true, error: null }))
    }

    const handleDisconnect = () => {
      setConnection((prev) => ({ ...prev, connected: false }))
    }

    const handleFileComplete = (payload: {
      activityId: string
      transferId: string
      downloadUrl: string
      transferPath: 'direct' | 'relay' | 'storage'
      senderParticipantId: string
    }) => {
      patchFileActivity(
        { transferId: payload.transferId, activityId: payload.activityId },
        {
          status: 'complete',
          progress: 1,
          transferPath: payload.transferPath,
          downloadUrl: payload.downloadUrl,
          objectUrl: payload.downloadUrl,
        },
      )
    }

    socket.onRoomState(handleRoomState)
    socket.onActivity(handleActivity)
    socket.onRoomExpired(handleExpired)
    socket.onSocketConnect(handleConnect)
    socket.onSocketDisconnect(handleDisconnect)
    socket.onFileTransferComplete(handleFileComplete)

    return () => {
      socket.offRoomState(handleRoomState)
      socket.offActivity(handleActivity)
      socket.offRoomExpired(handleExpired)
      socket.offSocketConnect(handleConnect)
      socket.offSocketDisconnect(handleDisconnect)
      socket.offFileTransferComplete(handleFileComplete)
    }
  }, [patchFileActivity])

  const createRoom = useCallback(async (password?: string) => {
    setIsLoading(true)
    setConnection({ connected: false, error: null })
    try {
      const { room: apiRoom, participantId: pid } = await api.createRoom(password)
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
    async (code: string, displayName = 'Guest', password?: string): Promise<JoinRoomResult> => {
      setIsLoading(true)
      setConnection({ connected: false, error: null })
      try {
        const normalized = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
        const { room: apiRoom, participantId: pid } = await api.joinRoom(
          normalized,
          displayName,
          password,
        )
        const mapped = mapApiRoom(apiRoom, pid)
        mapped.participants = mapped.participants.map((p) =>
          p.id === pid ? { ...p, name: displayName, isYou: true } : p,
        )
        await connectToRoom(normalized, pid, mapped)
        return { ok: true }
      } catch (error) {
        if (error instanceof ApiRequestError) {
          if (error.code === 'password_required' || error.code === 'incorrect_password') {
            return { ok: false, error: error.code }
          }
        }
        setConnection({
          connected: false,
          error: error instanceof Error ? error.message : 'Failed to join room',
        })
        return { ok: false, error: 'failed' }
      } finally {
        setIsLoading(false)
      }
    },
    [connectToRoom],
  )

  const leaveRoom = useCallback(() => {
    socket.emitLeaveRoom()
    socket.disconnectSocket()
    fileTransferManager.dispose()
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
      const transferId = crypto.randomUUID()
      pendingFilesRef.current.set(transferId, file)

      if (connection.connected) {
        socket.emitActivity({
          type: 'file',
          content: file.name,
          fileMeta: {
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || 'application/octet-stream',
            transferId,
            progress: 0,
            status: 'transferring',
          },
        })
        return
      }

      // Offline: local-only
      const objectUrl = URL.createObjectURL(file)
      pendingFilesRef.current.delete(transferId)
      setRoom((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          activities: [
            ...prev.activities,
            {
              id: crypto.randomUUID(),
              type: 'file',
              content: file.name,
              sender: 'You',
              senderId: participantId ?? undefined,
              timestamp: new Date(),
              fileMeta: {
                fileName: file.name,
                fileSize: file.size,
                mimeType: file.type || 'application/octet-stream',
                transferId,
                objectUrl,
                progress: 1,
                status: 'complete',
                transferPath: 'direct',
              },
            },
          ],
        }
      })
    },
    [connection.connected, participantId],
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
              senderId: participantId ?? undefined,
              timestamp: new Date(),
            },
          ],
        }
      })
    },
    [connection.connected, participantId],
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
