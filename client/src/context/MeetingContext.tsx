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

function displayParticipantName(name: string | undefined, isYou: boolean): string {
  if (isYou) return 'You'
  if (!name || name === 'You') return 'Host'
  return name
}

export function MeetingProvider({ children }: { children: ReactNode }) {
  const { room, participantId, addSystemActivity, updateParticipantMeetingState } = useRoom()
  const [isActive, setIsActive] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamVersion, setStreamVersion] = useState(0)

  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const screenVideoRef = useRef<HTMLVideoElement | null>(null)
  const acquiringRef = useRef(false)
  const isActiveRef = useRef(false)
  const participantIdRef = useRef(participantId)
  const updateMeetingRef = useRef(updateParticipantMeetingState)

  participantIdRef.current = participantId
  updateMeetingRef.current = updateParticipantMeetingState
  isActiveRef.current = isActive

  const attachStream = useCallback((video: HTMLVideoElement | null, stream: MediaStream | null) => {
    if (!video) return
    if (video.srcObject !== stream) {
      video.srcObject = stream
    }
    if (stream) {
      void video.play().catch(() => {
        // Autoplay may be blocked until a user gesture; ignore.
      })
    }
  }, [])

  useEffect(() => {
    attachStream(localVideoRef.current, isCameraOff ? null : localStreamRef.current)
  }, [isCameraOff, isActive, streamVersion, attachStream])

  useEffect(() => {
    attachStream(screenVideoRef.current, screenStreamRef.current)
  }, [isScreenSharing, streamVersion, attachStream])

  const stopLocalMedia = useCallback(() => {
    stopStream(localStreamRef.current)
    stopStream(screenStreamRef.current)
    localStreamRef.current = null
    screenStreamRef.current = null
    attachStream(localVideoRef.current, null)
    attachStream(screenVideoRef.current, null)
    setIsMuted(false)
    setIsCameraOff(false)
    setIsScreenSharing(false)
    setStreamVersion((v) => v + 1)
  }, [attachStream])

  const leaveMeetingLocal = useCallback(
    (announce: boolean) => {
      stopLocalMedia()
      setIsActive(false)
      setError(null)
      const pid = participantIdRef.current
      if (pid) {
        updateMeetingRef.current(pid, {
          inMeeting: false,
          isMuted: false,
          isCameraOff: false,
          isScreenSharing: false,
        })
      }
      if (announce) addSystemActivity('left the meeting')
    },
    [addSystemActivity, stopLocalMedia],
  )

  // Only tear down when leaving the room — never when callback identities change.
  useEffect(() => {
    if (!room && isActiveRef.current) {
      leaveMeetingLocal(false)
    }
  }, [room, leaveMeetingLocal])

  useEffect(() => {
    return () => {
      stopStream(localStreamRef.current)
      stopStream(screenStreamRef.current)
      localStreamRef.current = null
      screenStreamRef.current = null
    }
  }, [])

  const acquireMedia = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current
    if (acquiringRef.current) {
      // Wait briefly for in-flight acquire
      for (let i = 0; i < 40 && acquiringRef.current; i++) {
        await new Promise((r) => setTimeout(r, 50))
      }
      if (localStreamRef.current) return localStreamRef.current
    }

    acquiringRef.current = true
    try {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      } catch {
        // Camera busy/denied — still try audio-only so mic works
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true })
        setIsCameraOff(true)
      }
      localStreamRef.current = stream
      const hasVideo = stream.getVideoTracks().length > 0
      const hasAudio = stream.getAudioTracks().length > 0
      setIsMuted(!hasAudio)
      setIsCameraOff(!hasVideo)
      setStreamVersion((v) => v + 1)
      attachStream(localVideoRef.current, hasVideo ? stream : null)
      return stream
    } finally {
      acquiringRef.current = false
    }
  }, [attachStream])

  const startMeeting = useCallback(async () => {
    setError(null)
    try {
      await acquireMedia()
      setIsActive(true)
      const pid = participantIdRef.current
      if (pid) {
        updateMeetingRef.current(pid, {
          inMeeting: true,
          isMuted: false,
          isCameraOff: !localStreamRef.current?.getVideoTracks().length,
        })
      }
      addSystemActivity('started a meeting')
    } catch {
      setError('Camera or microphone access was denied. Check browser permissions and try again.')
      setIsActive(false)
    }
  }, [acquireMedia, addSystemActivity])

  // Peer started a meeting — show the call UI and request media (may need a click if autoplay/gesture blocked).
  useEffect(() => {
    if (!room?.meetingActive || isActive) return
    const self = room.participants.find((p) => p.isYou)
    if (self?.inMeeting) return

    void (async () => {
      setError(null)
      try {
        await acquireMedia()
        setIsActive(true)
        const pid = participantIdRef.current
        if (pid) {
          updateMeetingRef.current(pid, {
            inMeeting: true,
            isMuted: false,
            isCameraOff: !localStreamRef.current?.getVideoTracks().length,
          })
        }
      } catch {
        // Need a user gesture for getUserMedia in many browsers — keep lobby CTA visible.
        setError('Allow camera/microphone, then click Start meeting to join the call.')
      }
    })()
  }, [room?.meetingActive, room?.participants, isActive, acquireMedia])

  const endMeeting = useCallback(() => {
    leaveMeetingLocal(true)
  }, [leaveMeetingLocal])

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current?.getAudioTracks().length) {
      void acquireMedia()
        .then(() => {
          const next = true
          localStreamRef.current?.getAudioTracks().forEach((track) => {
            track.enabled = !next
          })
          setIsMuted(next)
          const pid = participantIdRef.current
          if (pid) updateMeetingRef.current(pid, { isMuted: next })
        })
        .catch(() => {
          setError('Microphone access was denied.')
        })
      return
    }
    const next = !isMuted
    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !next
    })
    setIsMuted(next)
    const pid = participantIdRef.current
    if (pid) updateMeetingRef.current(pid, { isMuted: next })
  }, [acquireMedia, isMuted])

  const toggleCamera = useCallback(() => {
    if (!localStreamRef.current?.getVideoTracks().length) {
      void acquireMedia()
        .then((stream) => {
          if (!stream.getVideoTracks().length) {
            setError('Camera is unavailable (in use by another tab or denied).')
            return
          }
          setIsCameraOff(false)
          setStreamVersion((v) => v + 1)
          const pid = participantIdRef.current
          if (pid) updateMeetingRef.current(pid, { isCameraOff: false })
        })
        .catch(() => {
          setError('Camera access was denied.')
        })
      return
    }
    const next = !isCameraOff
    localStreamRef.current.getVideoTracks().forEach((track) => {
      track.enabled = !next
    })
    setIsCameraOff(next)
    setStreamVersion((v) => v + 1)
    const pid = participantIdRef.current
    if (pid) updateMeetingRef.current(pid, { isCameraOff: next })
  }, [acquireMedia, isCameraOff])

  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      stopStream(screenStreamRef.current)
      screenStreamRef.current = null
      attachStream(screenVideoRef.current, null)
      setIsScreenSharing(false)
      setStreamVersion((v) => v + 1)
      const pid = participantIdRef.current
      if (pid) updateMeetingRef.current(pid, { isScreenSharing: false })
      addSystemActivity('stopped screen sharing')
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
      setStreamVersion((v) => v + 1)
      const pid = participantIdRef.current
      if (pid) updateMeetingRef.current(pid, { isScreenSharing: true })
      addSystemActivity('started screen sharing')

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopStream(screenStreamRef.current)
        screenStreamRef.current = null
        attachStream(screenVideoRef.current, null)
        setIsScreenSharing(false)
        setStreamVersion((v) => v + 1)
        const id = participantIdRef.current
        if (id) updateMeetingRef.current(id, { isScreenSharing: false })
        addSystemActivity('stopped screen sharing')
      })
    } catch {
      setError('Screen sharing was cancelled or blocked.')
    }
  }, [addSystemActivity, attachStream, isScreenSharing])

  const tiles = useMemo<MeetingTile[]>(() => {
    if (!room || !isActive) return []

    const self = room.participants.find((p) => p.isYou)
    const result: MeetingTile[] = [
      {
        id: self?.id ?? 'you',
        name: displayParticipantName(self?.name, true),
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
          name: displayParticipantName(remote.name, false),
          isMuted: remote.isMuted,
          isCameraOff: remote.isCameraOff ?? true,
          isScreenSharing: remote.isScreenSharing,
          // Remote A/V over WebRTC is out of scope — placeholder tile.
          stream: null,
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
  }, [room, isActive, isMuted, isCameraOff, isScreenSharing, streamVersion])

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
