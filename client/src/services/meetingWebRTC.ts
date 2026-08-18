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

  /** Lexicographic rule: higher id is the offerer (avoids glare). */
  private shouldOffer(peerId: string): boolean {
    if (!this.selfId) return false
    return this.selfId > peerId
  }

  setLocalStream(stream: MediaStream | null) {
    this.localStream = stream
    for (const { pc } of this.peers.values()) {
      this.syncSenders(pc, stream)
    }
  }

  private syncSenders(pc: RTCPeerConnection, stream: MediaStream | null) {
    const audioTrack = stream?.getAudioTracks()[0] ?? null
    const videoTrack = stream?.getVideoTracks()[0] ?? null

    const senderFor = (kind: 'audio' | 'video') => {
      const withTrack = pc.getSenders().find((s) => s.track?.kind === kind)
      if (withTrack) return withTrack
      const empty = pc
        .getTransceivers()
        .find((t) => t.sender && !t.sender.track && t.receiver.track?.kind === kind)
      if (empty) return empty.sender
      // Fall back to transceiver order: [0]=audio, [1]=video from ensurePeerShell.
      const idx = kind === 'audio' ? 0 : 1
      return pc.getTransceivers()[idx]?.sender
    }

    const audioSender = senderFor('audio')
    const videoSender = senderFor('video')
    if (audioSender) void audioSender.replaceTrack(audioTrack)
    else if (audioTrack && stream) pc.addTrack(audioTrack, stream)
    if (videoSender) void videoSender.replaceTrack(videoTrack)
    else if (videoTrack && stream) pc.addTrack(videoTrack, stream)
  }

  /** Replace outbound video track on all peers (camera ↔ screen) without renegotiation. */
  async replaceVideoTrack(track: MediaStreamTrack | null) {
    const tasks: Promise<void>[] = []
    for (const { pc } of this.peers.values()) {
      const sender =
        pc.getSenders().find((s) => s.track?.kind === 'video') ??
        pc.getTransceivers()[1]?.sender
      if (sender) {
        tasks.push(sender.replaceTrack(track).then(() => undefined))
      }
    }
    await Promise.all(tasks)
  }

  setAudioEnabled(enabled: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = enabled
    })
    for (const { pc } of this.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'audio')
      if (sender?.track) sender.track.enabled = enabled
    }
  }

  /**
   * Sync mesh to the current remote participant ids.
   * Rejects if total meeting size (self + remotes) would exceed MAX_MESH_PARTICIPANTS.
   */
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
        // Polite side: wait for their offer; ensure we can receive ICE early.
        this.ensurePeerShell(peerId)
      }
    }

    return { ok: true }
  }

  private ensurePeerShell(peerId: string): PeerConnection {
    const existing = this.peers.get(peerId)
    if (existing) return existing
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    // Always create senders so later replaceTrack (camera ↔ screen) needs no renegotiation.
    pc.addTransceiver('audio', { direction: 'sendrecv' })
    pc.addTransceiver('video', { direction: 'sendrecv' })
    const peer: PeerConnection = { pc, peerId }
    this.peers.set(peerId, peer)
    this.wirePc(peer)
    if (this.localStream) this.syncSenders(pc, this.localStream)
    return peer
  }

  private wirePc(peer: PeerConnection) {
    const { pc, peerId } = peer

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return
      this.emitSignal('meeting-ice-candidate', peerId, ev.candidate.toJSON())
    }

    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track])
      this.onRemoteStream?.(peerId, stream)
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.onRemoteStream?.(peerId, null)
      }
    }
  }

  private async createAndOffer(peerId: string) {
    if (this.makingOffer.has(peerId)) return
    this.makingOffer.add(peerId)
    try {
      const peer = this.ensurePeerShell(peerId)
      if (this.localStream) this.syncSenders(peer.pc, this.localStream)

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
    const peer = this.ensurePeerShell(peerId)
    if (this.localStream) this.syncSenders(peer.pc, this.localStream)

    await peer.pc.setRemoteDescription(payload.sdp)
    await this.flushCandidates(peerId, peer.pc)

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
    this.onRemoteStream?.(peerId, null)
  }

  dispose() {
    for (const id of [...this.peers.keys()]) this.closePeer(id)
    this.socket?.off('meeting-offer')
    this.socket?.off('meeting-answer')
    this.socket?.off('meeting-ice-candidate')
    this.localStream = null
    this.selfId = null
  }
}

export const meetingWebRTC = new MeetingWebRTCManager()
export { MAX_MESH_PARTICIPANTS }
