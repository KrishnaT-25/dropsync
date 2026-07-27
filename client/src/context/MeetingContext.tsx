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
import type { MeetingTile } from '../types'
import { useRoom } from './RoomContext'

interface MeetingContextValue {
  isActive: boolean
  isMuted: boolean
  isCameraOff: boolean
  isScreenSharing: boolean
  error: string | null
  tiles: MeetingTile[]
  localVideoRef: React.RefObject<HTMLVideoElement | null>
  screenVideoRef: React.RefObject<HTMLVideoElement | null>
  startMeeting: () => Promise<void>
  endMeeting: () => void
  toggleMute: () => void
  toggleCamera: () => void
  toggleScreenShare: () => Promise<void>
}

const MeetingContext = createContext<MeetingContextValue | null>(null)

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

export function MeetingProvider({ children }: { children: ReactNode }) {
  const { room, participantId, addSystemActivity, updateParticipantMeetingState } = useRoom()
  const [isActive, setIsActive] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const screenVideoRef = useRef<HTMLVideoElement | null>(null)

  const attachStream = useCallback((video: HTMLVideoElement | null, stream: MediaStream | null) => {
    if (video) video.srcObject = stream
  }, [])

  useEffect(() => {
    attachStream(localVideoRef.current, isCameraOff ? null : localStreamRef.current)
  }, [isCameraOff, isActive, attachStream])

  useEffect(() => {
    attachStream(screenVideoRef.current, screenStreamRef.current)
  }, [isScreenSharing, attachStream])

  useEffect(() => {
    if (room?.meetingActive && !isActive) {
      setIsActive(true)
    }
  }, [room?.meetingActive, isActive])

  const cleanup = useCallback(() => {
    stopStream(localStreamRef.current)
    stopStream(screenStreamRef.current)
    localStreamRef.current = null
    screenStreamRef.current = null
    attachStream(localVideoRef.current, null)
    attachStream(screenVideoRef.current, null)
    setIsActive(false)
    setIsMuted(false)
    setIsCameraOff(false)
    setIsScreenSharing(false)
    setError(null)
    if (participantId) {
      updateParticipantMeetingState(participantId, {
        inMeeting: false,
        isMuted: false,
        isCameraOff: false,
        isScreenSharing: false,
      })
    }
  }, [attachStream, participantId, updateParticipantMeetingState])

  useEffect(() => {
    if (!room) cleanup()
  }, [room, cleanup])

  useEffect(() => {
    return () => cleanup()
  }, [cleanup])

  const startMeeting = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })
      localStreamRef.current = stream
      attachStream(localVideoRef.current, stream)
      setIsActive(true)
      setIsMuted(false)
      setIsCameraOff(false)
      if (participantId) {
        updateParticipantMeetingState(participantId, { inMeeting: true, isMuted: false, isCameraOff: false })
      }
      addSystemActivity('You started a meeting')
    } catch {
      setError('Camera or microphone access was denied. Check browser permissions.')
    }
  }, [addSystemActivity, attachStream, participantId, updateParticipantMeetingState])

  const endMeeting = useCallback(() => {
    cleanup()
    addSystemActivity('You left the meeting')
  }, [addSystemActivity, cleanup])

  const toggleMute = useCallback(() => {
    const next = !isMuted
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next
    })
    setIsMuted(next)
    if (participantId) {
      updateParticipantMeetingState(participantId, { isMuted: next })
    }
  }, [isMuted, participantId, updateParticipantMeetingState])

  const toggleCamera = useCallback(() => {
    const next = !isCameraOff
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = !next
    })
    setIsCameraOff(next)
    if (participantId) {
      updateParticipantMeetingState(participantId, { isCameraOff: next })
    }
  }, [isCameraOff, participantId, updateParticipantMeetingState])

  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      stopStream(screenStreamRef.current)
      screenStreamRef.current = null
      attachStream(screenVideoRef.current, null)
      setIsScreenSharing(false)
      if (participantId) {
        updateParticipantMeetingState(participantId, { isScreenSharing: false })
      }
      addSystemActivity('You stopped sharing your screen')
      return
    }

    setError(null)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })
      screenStreamRef.current = stream
      attachStream(screenVideoRef.current, stream)
      setIsScreenSharing(true)
      if (participantId) {
        updateParticipantMeetingState(participantId, { isScreenSharing: true })
      }
      addSystemActivity('You started sharing your screen')

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopStream(screenStreamRef.current)
        screenStreamRef.current = null
        attachStream(screenVideoRef.current, null)
        setIsScreenSharing(false)
        if (participantId) {
          updateParticipantMeetingState(participantId, { isScreenSharing: false })
        }
        addSystemActivity('You stopped sharing your screen')
      })
    } catch {
      setError('Screen sharing was cancelled or blocked.')
    }
  }, [addSystemActivity, attachStream, isScreenSharing, participantId, updateParticipantMeetingState])

  const tiles = useMemo<MeetingTile[]>(() => {
    if (!room || !isActive) return []

    const self = room.participants.find((p) => p.isYou)
    const result: MeetingTile[] = [
      {
        id: self?.id ?? 'you',
        name: self?.name ?? 'You',
        isYou: true,
        isMuted,
        isCameraOff,
        isScreenSharing,
        stream: isCameraOff ? null : localStreamRef.current,
      },
    ]

    room.participants
      .filter((p) => !p.isYou && p.inMeeting)
      .forEach((remote) => {
        result.push({
          id: remote.id,
          name: remote.name,
          isMuted: remote.isMuted,
          isCameraOff: remote.isCameraOff,
          isScreenSharing: remote.isScreenSharing,
        })
      })

    if (isScreenSharing && screenStreamRef.current) {
      result.unshift({
        id: 'screen-you',
        name: 'Your screen',
        isYou: true,
        isScreenSharing: true,
        stream: screenStreamRef.current,
      })
    }

    return result
  }, [room, isActive, isMuted, isCameraOff, isScreenSharing])

  const value = useMemo(
    () => ({
      isActive,
      isMuted,
      isCameraOff,
      isScreenSharing,
      error,
      tiles,
      localVideoRef,
      screenVideoRef,
      startMeeting,
      endMeeting,
      toggleMute,
      toggleCamera,
      toggleScreenShare,
    }),
    [
      isActive,
      isMuted,
      isCameraOff,
      isScreenSharing,
      error,
      tiles,
      startMeeting,
      endMeeting,
      toggleMute,
      toggleCamera,
      toggleScreenShare,
    ],
  )

  return <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>
}

export function useMeeting() {
  const ctx = useContext(MeetingContext)
  if (!ctx) throw new Error('useMeeting must be used within MeetingProvider')
  return ctx
}
