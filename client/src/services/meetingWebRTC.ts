import type { Socket } from 'socket.io-client'
import { getIceServers } from './api'

const MAX_MESH_PARTICIPANTS = 6

interface SignalMessage {
  targetParticipantId: string
  senderParticipantId: string
  payload: unknown
}

interface PeerConnection {
  pc: RTCPeerConnection
  peerId: string
}

type RemoteStreamHandler = (peerId: string, stream: MediaStream | null) => void
type MeshErrorHandler = (message: string) => void

/** Keep an always-live video m-line so replaceTrack(screen) works for every peer. */
function createBlackVideoTrack(): MediaStreamTrack {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#0b0e11'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  const stream = canvas.captureStream(5)
  const track = stream.getVideoTracks()[0]
  if (!track) throw new Error('Could not create placeholder video track')
  track.contentHint = 'motion'
  return track
}

/**
 * Mesh WebRTC for meeting A/V (one RTCPeerConnection per remote peer).
 * Signaling mirrors fileTransfer.ts: offer/answer/ICE with candidate queue.
 */
export class MeetingWebRTCManager {
  private selfId: string | null = null
  private socket: Socket | null = null
  private iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
  private peers = new Map<string, PeerConnection>()
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>()
  private localStream: MediaStream | null = null
  /** Outbound video currently pushed to peers (camera, screen, or black placeholder). */
  private outboundVideoTrack: MediaStreamTrack | null = null
  private placeholderVideoTrack: MediaStreamTrack | null = null
  private remoteStreams = new Map<string, MediaStream>()
  private onRemoteStream: RemoteStreamHandler | null = null
  private onMeshError: MeshErrorHandler | null = null
  private makingOffer = new Set<string>()

  configure(opts: {
    selfId: string
    socket: Socket
    onRemoteStream: RemoteStreamHandler
    onMeshError?: MeshErrorHandler
  }) {
    this.selfId = opts.selfId
    this.socket = opts.socket
    this.onRemoteStream = opts.onRemoteStream
    this.onMeshError = opts.onMeshError ?? null
    this.bindSocket()
    void this.refreshIceServers()
  }

  async refreshIceServers() {
    try {
      const { iceServers } = await getIceServers()
      if (iceServers?.length) this.iceServers = iceServers
    } catch {
      // keep defaults
    }
  }

  private bindSocket() {
    if (!this.socket) return
    this.socket.off('meeting-offer')
    this.socket.off('meeting-answer')
    this.socket.off('meeting-ice-candidate')

    this.socket.on('meeting-offer', (msg: SignalMessage) => {
      if (msg.targetParticipantId !== this.selfId) return
      void this.handleOffer(msg)
    })
    this.socket.on('meeting-answer', (msg: SignalMessage) => {
      if (msg.targetParticipantId !== this.selfId) return
      void this.handleAnswer(msg)
    })
    this.socket.on('meeting-ice-candidate', (msg: SignalMessage) => {
      if (msg.targetParticipantId !== this.selfId) return
      void this.handleRemoteCandidate(msg)
    })
  }

  private emitSignal(
    event: 'meeting-offer' | 'meeting-answer' | 'meeting-ice-candidate',
    targetParticipantId: string,
    payload: unknown,
  ) {
    if (!this.socket || !this.selfId) return
    this.socket.emit(event, {
      targetParticipantId,
      senderParticipantId: this.selfId,
      payload,
    } satisfies SignalMessage)
  }

  private shouldOffer(peerId: string): boolean {
    if (!this.selfId) return false
    return this.selfId > peerId
  }

  private ensurePlaceholder(): MediaStreamTrack {
    if (!this.placeholderVideoTrack || this.placeholderVideoTrack.readyState === 'ended') {
      this.placeholderVideoTrack = createBlackVideoTrack()
    }
    return this.placeholderVideoTrack
  }

  private videoTrackForSend(stream: MediaStream | null): MediaStreamTrack {
    const cam = stream?.getVideoTracks().find((t) => t.readyState === 'live' && t.enabled) ?? null
    if (cam) return cam
    const anyCam = stream?.getVideoTracks()[0] ?? null
    if (anyCam && anyCam.readyState === 'live') return anyCam
    return this.ensurePlaceholder()
  }

  setLocalStream(stream: MediaStream | null) {
    this.localStream = stream
    // Don't clobber an active screen-share outbound track.
    if (this.outboundVideoTrack?.getSettings().displaySurface) {
      for (const { pc } of this.peers.values()) {
        this.syncAudioSender(pc, stream)
      }
      return
    }
    this.outboundVideoTrack = this.videoTrackForSend(stream)
    for (const { pc } of this.peers.values()) {
      this.syncSenders(pc, stream, this.outboundVideoTrack)
    }
  }

  private findSender(pc: RTCPeerConnection, kind: 'audio' | 'video'): RTCRtpSender | null {
    const withTrack = pc.getSenders().find((s) => s.track?.kind === kind)
    if (withTrack) return withTrack
    const byTransceiver = pc.getTransceivers().find((t) => {
      if (t.sender.track?.kind === kind) return true
      if (t.receiver.track?.kind === kind) return true
      return false
    })
    if (byTransceiver) return byTransceiver.sender
    const idx = kind === 'audio' ? 0 : 1
    return pc.getTransceivers()[idx]?.sender ?? null
  }

  private syncAudioSender(pc: RTCPeerConnection, stream: MediaStream | null) {
    const audioTrack = stream?.getAudioTracks()[0] ?? null
    const sender = this.findSender(pc, 'audio')
    if (sender) void sender.replaceTrack(audioTrack)
    else if (audioTrack && stream) pc.addTrack(audioTrack, stream)
  }

  private syncSenders(
    pc: RTCPeerConnection,
    stream: MediaStream | null,
    videoTrack: MediaStreamTrack | null,
  ) {
    this.syncAudioSender(pc, stream)
    const sender = this.findSender(pc, 'video')
    if (sender) void sender.replaceTrack(videoTrack)
    else if (videoTrack) {
      const ms = stream ?? new MediaStream([videoTrack])
      if (!stream) ms.addTrack(videoTrack)
      pc.addTrack(videoTrack, ms)
    }
  }

  /** Replace outbound video on every peer (camera ↔ screen ↔ placeholder). */
  async replaceVideoTrack(track: MediaStreamTrack | null) {
    const next = track ?? this.videoTrackForSend(this.localStream)
    if (track) {
      try {
        track.contentHint = track.getSettings().displaySurface ? 'detail' : 'motion'
      } catch {
        // ignore
      }
    }
    this.outboundVideoTrack = next
    const tasks: Promise<void>[] = []
    for (const { pc } of this.peers.values()) {
      const sender = this.findSender(pc, 'video')
      if (sender) {
        tasks.push(
          sender.replaceTrack(next).then(() => undefined).catch(() => undefined),
        )
      } else if (next) {
        pc.addTrack(next, this.localStream ?? new MediaStream([next]))
      }
    }
    await Promise.all(tasks)
  }

  setAudioEnabled(enabled: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = enabled
    })
    for (const { pc } of this.peers.values()) {
      const sender = this.findSender(pc, 'audio')
      if (sender?.track) sender.track.enabled = enabled
    }
  }

  async syncPeers(remoteParticipantIds: string[]): Promise<{ ok: boolean; error?: string }> {
    await this.refreshIceServers()
    const unique = [...new Set(remoteParticipantIds)].filter((id) => id && id !== this.selfId)
    const total = unique.length + 1
    if (total > MAX_MESH_PARTICIPANTS) {
      const msg = `This meeting supports at most ${MAX_MESH_PARTICIPANTS} participants.`
      this.onMeshError?.(msg)
      return { ok: false, error: msg }
    }

    for (const id of [...this.peers.keys()]) {
      if (!unique.includes(id)) this.closePeer(id)
    }

    for (const peerId of unique) {
      if (!this.peers.has(peerId) && this.shouldOffer(peerId)) {
        await this.createAndOffer(peerId)
      } else if (!this.peers.has(peerId)) {
        this.ensurePeerShell(peerId, { addOutbound: true })
      }
    }

    return { ok: true }
  }

  private ensurePeerShell(
    peerId: string,
    opts: { addOutbound: boolean },
  ): PeerConnection {
    const existing = this.peers.get(peerId)
    if (existing) return existing
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    const peer: PeerConnection = { pc, peerId }
    this.peers.set(peerId, peer)
    this.wirePc(peer)

    if (opts.addOutbound) {
      const audio = this.localStream?.getAudioTracks()[0]
      const video = this.outboundVideoTrack ?? this.videoTrackForSend(this.localStream)
      this.outboundVideoTrack = video
      if (audio && this.localStream) pc.addTrack(audio, this.localStream)
      else pc.addTransceiver('audio', { direction: 'sendrecv' })
      const videoStream = this.localStream ?? new MediaStream([video])
      if (!this.localStream) videoStream.addTrack(video)
      pc.addTrack(video, videoStream)
    }

    return peer
  }

  private wirePc(peer: PeerConnection) {
    const { pc, peerId } = peer

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return
      this.emitSignal('meeting-ice-candidate', peerId, ev.candidate.toJSON())
    }

    pc.ontrack = (ev) => {
      let stream = this.remoteStreams.get(peerId)
      if (!stream) {
        stream = ev.streams[0] ?? new MediaStream()
        this.remoteStreams.set(peerId, stream)
      }
      // Merge tracks into a stable MediaStream so replaceTrack updates stay attached to the tile.
      if (!stream.getTracks().some((t) => t.id === ev.track.id)) {
        // Drop old same-kind tracks (camera → screen replace can deliver a new track).
        stream.getTracks().forEach((t) => {
          if (t.kind === ev.track.kind) {
            stream!.removeTrack(t)
          }
        })
        stream.addTrack(ev.track)
      }

      const publish = () => this.onRemoteStream?.(peerId, stream!)
      publish()
      ev.track.onunmute = publish
      ev.track.onmute = publish
      ev.track.onended = () => {
        stream?.removeTrack(ev.track)
        publish()
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.remoteStreams.delete(peerId)
        this.onRemoteStream?.(peerId, null)
      }
    }
  }

  private async createAndOffer(peerId: string) {
    if (this.makingOffer.has(peerId)) return
    this.makingOffer.add(peerId)
    try {
      const peer = this.ensurePeerShell(peerId, { addOutbound: true })
      const offer = await peer.pc.createOffer()
      await peer.pc.setLocalDescription(offer)
      this.emitSignal('meeting-offer', peerId, { sdp: peer.pc.localDescription })
    } catch {
      this.closePeer(peerId)
    } finally {
      this.makingOffer.delete(peerId)
    }
  }

  private async handleOffer(msg: SignalMessage) {
    const payload = msg.payload as { sdp: RTCSessionDescriptionInit }
    const peerId = msg.senderParticipantId
    // Answerer: set remote description first so m-lines align, then attach local tracks.
    let peer = this.peers.get(peerId)
    if (!peer) {
      const pc = new RTCPeerConnection({ iceServers: this.iceServers })
      peer = { pc, peerId }
      this.peers.set(peerId, peer)
      this.wirePc(peer)
    }

    await peer.pc.setRemoteDescription(payload.sdp)
    await this.flushCandidates(peerId, peer.pc)

    const audio = this.localStream?.getAudioTracks()[0] ?? null
    const video = this.outboundVideoTrack ?? this.videoTrackForSend(this.localStream)
    this.outboundVideoTrack = video

    const audioSender = this.findSender(peer.pc, 'audio')
    const videoSender = this.findSender(peer.pc, 'video')
    if (audioSender) await audioSender.replaceTrack(audio)
    else if (audio && this.localStream) peer.pc.addTrack(audio, this.localStream)

    if (videoSender) await videoSender.replaceTrack(video)
    else {
      const vs = this.localStream ?? new MediaStream([video])
      peer.pc.addTrack(video, vs)
    }

    const answer = await peer.pc.createAnswer()
    await peer.pc.setLocalDescription(answer)
    this.emitSignal('meeting-answer', peerId, { sdp: peer.pc.localDescription })
  }

  private async handleAnswer(msg: SignalMessage) {
    const payload = msg.payload as { sdp: RTCSessionDescriptionInit }
    const peer = this.peers.get(msg.senderParticipantId)
    if (!peer) return
    await peer.pc.setRemoteDescription(payload.sdp)
    await this.flushCandidates(msg.senderParticipantId, peer.pc)
  }

  private async handleRemoteCandidate(msg: SignalMessage) {
    const candidate = msg.payload as RTCIceCandidateInit
    const peerId = msg.senderParticipantId
    const peer = this.peers.get(peerId)
    if (!peer || !peer.pc.remoteDescription) {
      const list = this.pendingCandidates.get(peerId) ?? []
      list.push(candidate)
      this.pendingCandidates.set(peerId, list)
      return
    }
    try {
      await peer.pc.addIceCandidate(candidate)
    } catch {
      // ignore
    }
  }

  private async flushCandidates(peerId: string, pc: RTCPeerConnection) {
    const queued = this.pendingCandidates.get(peerId) ?? []
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c)
      } catch {
        // ignore
      }
    }
    this.pendingCandidates.delete(peerId)
  }

  closePeer(peerId: string) {
    const peer = this.peers.get(peerId)
    if (!peer) return
    try {
      peer.pc.close()
    } catch {
      // ignore
    }
    this.peers.delete(peerId)
    this.pendingCandidates.delete(peerId)
    this.remoteStreams.delete(peerId)
    this.onRemoteStream?.(peerId, null)
  }

  dispose() {
    for (const id of [...this.peers.keys()]) this.closePeer(id)
    this.socket?.off('meeting-offer')
    this.socket?.off('meeting-answer')
    this.socket?.off('meeting-ice-candidate')
    this.placeholderVideoTrack?.stop()
    this.placeholderVideoTrack = null
    this.outboundVideoTrack = null
    this.localStream = null
    this.selfId = null
  }
}

export const meetingWebRTC = new MeetingWebRTCManager()
export { MAX_MESH_PARTICIPANTS }
