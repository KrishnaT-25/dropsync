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
import { meetingWebRTC } from '../services/meetingWebRTC'
import { getMeetingSocket } from '../services/meetingSocket'
import type { MeetingTile } from '../types'
import { useMeetingSession } from './MeetingSessionContext'

interface MeetingContextValue {
  isMuted: boolean
  isCameraOff: boolean
  isScreenSharing: boolean
  error: string | null
  tiles: MeetingTile[]
  previewStream: MediaStream | null
  localVideoRef: React.RefObject<HTMLVideoElement | null>
  screenVideoRef: React.RefObject<HTMLVideoElement | null>
  ensurePreview: () => Promise<MediaStream | null>
  stopPreview: () => void
  leaveOrEnd: () => void
  toggleMute: () => void
  toggleCamera: () => void
  toggleScreenShare: () => Promise<void>
}

const MeetingContext = createContext<MeetingContextValue | null>(null)

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

export function MeetingProvider({ children }: { children: ReactNode }) {
  const {
    meeting,
    participantId,
    isJoined,
    isHost,
    leaveCall,
    endCallForEveryone,
    emitMediaState,
    emitActivity,
  } = useMeetingSession()

  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamVersion, setStreamVersion] = useState(0)
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream | null>>({})

  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const screenVideoRef = useRef<HTMLVideoElement | null>(null)
  const acquiringRef = useRef(false)
  const webrtcReadyRef = useRef(false)

  const attachStream = useCallback((video: HTMLVideoElement | null, stream: MediaStream | null) => {
    if (!video) return
    if (video.srcObject !== stream) {
      video.srcObject = stream
    }
    if (stream) {
      void video.play().catch(() => {
        // ignore autoplay rejection
      })
    }
  }, [])

  useEffect(() => {
    attachStream(localVideoRef.current, isCameraOff ? null : localStreamRef.current)
  }, [isCameraOff, isJoined, streamVersion, attachStream])

  useEffect(() => {
    attachStream(screenVideoRef.current, screenStreamRef.current)
  }, [isScreenSharing, streamVersion, attachStream])

  const stopPreview = useCallback(() => {
    meetingWebRTC.dispose()
    webrtcReadyRef.current = false
    stopStream(localStreamRef.current)
    stopStream(screenStreamRef.current)
    localStreamRef.current = null
    screenStreamRef.current = null
    setPreviewStream(null)
    setRemoteStreams({})
    attachStream(localVideoRef.current, null)
    attachStream(screenVideoRef.current, null)
    setIsMuted(false)
    setIsCameraOff(false)
    setIsScreenSharing(false)
    setStreamVersion((v) => v + 1)
  }, [attachStream])

  useEffect(() => {
    return () => {
      meetingWebRTC.dispose()
      stopStream(localStreamRef.current)
      stopStream(screenStreamRef.current)
    }
  }, [])

  const acquireMedia = useCallback(async () => {
    if (localStreamRef.current) {
      setPreviewStream(localStreamRef.current)
      return localStreamRef.current
    }
    if (acquiringRef.current) {
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
        setIsCameraOff(false)
        setIsMuted(false)
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true })
        setIsCameraOff(true)
        setIsMuted(false)
      }
      localStreamRef.current = stream
      setPreviewStream(stream)
      setStreamVersion((v) => v + 1)
      attachStream(localVideoRef.current, stream.getVideoTracks().length ? stream : null)
      meetingWebRTC.setLocalStream(stream)
      return stream
    } finally {
      acquiringRef.current = false
    }
  }, [attachStream])

  const ensurePreview = useCallback(async () => {
    setError(null)
    try {
      return await acquireMedia()
    } catch {
      setError('Camera or microphone access was denied.')
      return null
    }
  }, [acquireMedia])

  // Configure mesh when joined; tear down when left.
  useEffect(() => {
    if (!isJoined || !participantId) {
      if (webrtcReadyRef.current) {
        meetingWebRTC.dispose()
        webrtcReadyRef.current = false
        setRemoteStreams({})
      }
      return
    }

    meetingWebRTC.configure({
      selfId: participantId,
      socket: getMeetingSocket(),
      onRemoteStream: (peerId, stream) => {
        setRemoteStreams((prev) => {
          if (prev[peerId] === stream) return prev
          return { ...prev, [peerId]: stream }
        })
        setStreamVersion((v) => v + 1)
      },
      onMeshError: (message) => setError(message),
    })
    webrtcReadyRef.current = true

    if (localStreamRef.current) {
      meetingWebRTC.setLocalStream(localStreamRef.current)
    } else {
      void acquireMedia().catch(() => {
        setError('Camera or microphone access was denied.')
      })
    }

    return () => {
      meetingWebRTC.dispose()
      webrtcReadyRef.current = false
    }
  }, [isJoined, participantId, acquireMedia])

  // Sync peer connections whenever roster changes.
  useEffect(() => {
    if (!isJoined || !participantId || !meeting) return
    const remoteIds = meeting.participants.filter((p) => p.id !== participantId).map((p) => p.id)
    void meetingWebRTC.syncPeers(remoteIds).then((result) => {
      if (!result.ok && result.error) setError(result.error)
    })
  }, [isJoined, participantId, meeting])

  useEffect(() => {
    const onForceMute = () => {
      if (!localStreamRef.current) return
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = false
      })
      meetingWebRTC.setAudioEnabled(false)
      setIsMuted(true)
      emitMediaState({ isMuted: true })
    }
    window.addEventListener('dropsync-force-mute', onForceMute)
    return () => window.removeEventListener('dropsync-force-mute', onForceMute)
  }, [emitMediaState])

  const leaveOrEnd = useCallback(() => {
    if (isHost) {
      emitActivity('ended the meeting')
      endCallForEveryone()
    } else {
      emitActivity('left the call')
      leaveCall()
    }
    stopPreview()
  }, [emitActivity, endCallForEveryone, isHost, leaveCall, stopPreview])

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current?.getAudioTracks().length) {
      void ensurePreview()
      return
    }
    const next = !isMuted
    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !next
    })
    meetingWebRTC.setAudioEnabled(!next)
    setIsMuted(next)
    emitMediaState({ isMuted: next })
  }, [emitMediaState, ensurePreview, isMuted])

  const toggleCamera = useCallback(() => {
    if (!localStreamRef.current?.getVideoTracks().length) {
      void ensurePreview().then((stream) => {
        if (!stream?.getVideoTracks().length) {
          setError('Camera is unavailable.')
        }
      })
      return
    }
    const next = !isCameraOff
    localStreamRef.current.getVideoTracks().forEach((track) => {
      track.enabled = !next
    })
    // If not screen sharing, push camera (or null) to peers.
    if (!isScreenSharing) {
      const cam = next ? null : localStreamRef.current.getVideoTracks()[0] ?? null
      void meetingWebRTC.replaceVideoTrack(cam)
    }
    setIsCameraOff(next)
    setStreamVersion((v) => v + 1)
    emitMediaState({ isCameraOff: next })
  }, [emitMediaState, ensurePreview, isCameraOff, isScreenSharing])

  const restoreCameraVideoTrack = useCallback(async () => {
    const cam = !isCameraOff ? localStreamRef.current?.getVideoTracks()[0] ?? null : null
    await meetingWebRTC.replaceVideoTrack(cam)
  }, [isCameraOff])

  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      stopStream(screenStreamRef.current)
      screenStreamRef.current = null
      attachStream(screenVideoRef.current, null)
      setIsScreenSharing(false)
      setStreamVersion((v) => v + 1)
      emitMediaState({ isScreenSharing: false })
      emitActivity('stopped screen sharing')
      await restoreCameraVideoTrack()
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
      emitMediaState({ isScreenSharing: true })
      emitActivity('started screen sharing')

      const displayTrack = stream.getVideoTracks()[0] ?? null
      if (displayTrack) {
        displayTrack.contentHint = 'detail'
        await meetingWebRTC.replaceVideoTrack(displayTrack)
      }

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopStream(screenStreamRef.current)
        screenStreamRef.current = null
        attachStream(screenVideoRef.current, null)
        setIsScreenSharing(false)
        setStreamVersion((v) => v + 1)
        emitMediaState({ isScreenSharing: false })
        emitActivity('stopped screen sharing')
        void restoreCameraVideoTrack()
      })
    } catch {
      setError('Screen sharing was cancelled or blocked.')
    }
  }, [attachStream, emitActivity, emitMediaState, isScreenSharing, restoreCameraVideoTrack])

  const tiles = useMemo<MeetingTile[]>(() => {
    if (!meeting || !isJoined) return []

    const self = meeting.participants.find((p) => p.id === participantId)
    const result: MeetingTile[] = [
      {
        id: self?.id ?? 'you',
        name: 'You',
        isYou: true,
        isHost: self?.isHost,
        isMuted,
        isCameraOff,
        isScreenSharing,
        stream: isCameraOff ? null : localStreamRef.current,
      },
    ]

    meeting.participants
      .filter((p) => p.id !== participantId)
      .forEach((remote) => {
        result.push({
          id: remote.id,
          name: remote.name,
          isHost: remote.isHost,
          isMuted: remote.isMuted,
          isCameraOff: remote.isCameraOff,
          isScreenSharing: remote.isScreenSharing,
          stream: remoteStreams[remote.id] ?? null,
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
  }, [
    meeting,
    isJoined,
    participantId,
    isMuted,
    isCameraOff,
    isScreenSharing,
    streamVersion,
    remoteStreams,
  ])

  const value = useMemo(
    () => ({
      isMuted,
      isCameraOff,
      isScreenSharing,
      error,
      tiles,
      previewStream,
      localVideoRef,
      screenVideoRef,
      ensurePreview,
      stopPreview,
      leaveOrEnd,
      toggleMute,
      toggleCamera,
      toggleScreenShare,
    }),
    [
      isMuted,
      isCameraOff,
      isScreenSharing,
      error,
      tiles,
      previewStream,
      ensurePreview,
      stopPreview,
      leaveOrEnd,
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
