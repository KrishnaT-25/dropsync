import type { Socket } from 'socket.io-client'
import { getIceServers, recordTransferStat, uploadFallbackFile } from './api'

const CHUNK_SIZE = 16 * 1024
const BUFFER_LOW = 256 * 1024
const CONNECT_TIMEOUT_MS = 10_000

export type TransferPath = 'direct' | 'relay' | 'storage'
export type TransferStatus = 'pending' | 'transferring' | 'complete' | 'failed'

export interface FileTransferProgress {
  transferId: string
  activityId: string
  progress: number
  status: TransferStatus
  transferPath?: TransferPath
  objectUrl?: string
  downloadUrl?: string
  error?: string
}

interface FileSignalMessage {
  targetParticipantId: string
  senderParticipantId: string
  payload: unknown
}

interface HeaderMessage {
  type: 'header'
  transferId: string
  activityId: string
  fileName: string
  fileSize: number
  mimeType: string
}

interface DoneMessage {
  type: 'done'
  transferId: string
  totalChunks: number
}

type ControlMessage = HeaderMessage | DoneMessage

interface OutgoingPeer {
  pc: RTCPeerConnection
  channel: RTCDataChannel
  peerId: string
  usedRelay: boolean
}

interface IncomingState {
  transferId: string
  activityId: string
  fileName: string
  fileSize: number
  mimeType: string
  chunks: ArrayBuffer[]
  received: number
  pc: RTCPeerConnection
  peerId: string
}

type ProgressHandler = (update: FileTransferProgress) => void

export class FileTransferManager {
  private selfId: string | null = null
  private socket: Socket | null = null
  private onProgress: ProgressHandler | null = null
  private iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
  private outgoing = new Map<string, OutgoingPeer>() // key: `${transferId}:${peerId}`
  private incoming = new Map<string, IncomingState>() // key: transferId
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>()

  configure(opts: {
    selfId: string
    socket: Socket
    onProgress: ProgressHandler
  }) {
    this.selfId = opts.selfId
    this.socket = opts.socket
    this.onProgress = opts.onProgress
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
    this.socket.off('file-offer')
    this.socket.off('file-answer')
    this.socket.off('file-ice-candidate')

    this.socket.on('file-offer', (msg: FileSignalMessage) => {
      void this.handleOffer(msg)
    })
    this.socket.on('file-answer', (msg: FileSignalMessage) => {
      void this.handleAnswer(msg)
    })
    this.socket.on('file-ice-candidate', (msg: FileSignalMessage) => {
      void this.handleRemoteCandidate(msg)
    })
  }

  private emitSignal(
    event: 'file-offer' | 'file-answer' | 'file-ice-candidate',
    targetParticipantId: string,
    payload: unknown,
  ) {
    if (!this.socket || !this.selfId) return
    this.socket.emit(event, {
      targetParticipantId,
      senderParticipantId: this.selfId,
      payload,
    } satisfies FileSignalMessage)
  }

  private key(transferId: string, peerId: string) {
    return `${transferId}:${peerId}`
  }

  async sendFileToPeers(opts: {
    file: File
    transferId: string
    activityId: string
    recipientIds: string[]
  }): Promise<void> {
    await this.refreshIceServers()
    const { file, transferId, activityId, recipientIds } = opts

    if (recipientIds.length === 0) {
      const objectUrl = URL.createObjectURL(file)
      this.onProgress?.({
        transferId,
        activityId,
        progress: 1,
        status: 'complete',
        transferPath: 'direct',
        objectUrl,
      })
      return
    }

    this.onProgress?.({
      transferId,
      activityId,
      progress: 0,
      status: 'transferring',
    })

    const results = await Promise.all(
      recipientIds.map((peerId) => this.sendToPeer({ file, transferId, activityId, peerId })),
    )

    const anyOk = results.some((r) => r.ok)
    if (anyOk) {
      const usedRelay = results.some((r) => r.ok && r.path === 'relay')
      const path: TransferPath = usedRelay ? 'relay' : 'direct'
      void recordTransferStat(path)
      this.onProgress?.({
        transferId,
        activityId,
        progress: 1,
        status: 'complete',
        transferPath: path,
        objectUrl: URL.createObjectURL(file),
      })
      return
    }

    // Fallback: upload once, broadcast download URL via socket
    try {
      const uploaded = await uploadFallbackFile(file)
      void recordTransferStat('storage')
      this.socket?.emit('file-transfer-complete', {
        activityId,
        transferId,
        downloadUrl: uploaded.downloadUrl,
        transferPath: 'storage',
      })
      this.onProgress?.({
        transferId,
        activityId,
        progress: 1,
        status: 'complete',
        transferPath: 'storage',
        objectUrl: URL.createObjectURL(file),
        downloadUrl: uploaded.downloadUrl,
      })
    } catch (err) {
      this.onProgress?.({
        transferId,
        activityId,
        progress: 0,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Transfer failed',
      })
    }
  }

  private async sendToPeer(opts: {
    file: File
    transferId: string
    activityId: string
    peerId: string
  }): Promise<{ ok: boolean; path?: TransferPath }> {
    const { file, transferId, activityId, peerId } = opts
    const mapKey = this.key(transferId, peerId)

    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    const channel = pc.createDataChannel('file-transfer', { ordered: true })
    channel.binaryType = 'arraybuffer'
    channel.bufferedAmountLowThreshold = BUFFER_LOW

    const peer: OutgoingPeer = { pc, channel, peerId, usedRelay: false }
    this.outgoing.set(mapKey, peer)

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !this.selfId) return
      if (ev.candidate.candidate.includes(' typ relay ')) peer.usedRelay = true
      this.emitSignal('file-ice-candidate', peerId, ev.candidate.toJSON())
    }

    const connected = this.waitForChannelOpen(channel, pc, CONNECT_TIMEOUT_MS)

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.emitSignal('file-offer', peerId, {
        sdp: pc.localDescription,
        transferId,
        activityId,
      })

      const ok = await connected
      if (!ok) {
        this.closeOutgoing(mapKey)
        return { ok: false }
      }

      await this.pushFileOverChannel(channel, {
        transferId,
        activityId,
        file,
      })

      const path: TransferPath = peer.usedRelay ? 'relay' : 'direct'
      this.closeOutgoing(mapKey)
      return { ok: true, path }
    } catch {
      this.closeOutgoing(mapKey)
      return { ok: false }
    }
  }

  private waitForChannelOpen(
    channel: RTCDataChannel,
    pc: RTCPeerConnection,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false
      const done = (value: boolean) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      }

      const timer = window.setTimeout(() => done(false), timeoutMs)

      const onOpen = () => done(true)
      const onFail = () => done(false)

      const cleanup = () => {
        window.clearTimeout(timer)
        channel.removeEventListener('open', onOpen)
        channel.removeEventListener('error', onFail)
        channel.removeEventListener('close', onFail)
        pc.removeEventListener('connectionstatechange', onState)
      }

      const onState = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') done(false)
      }

      channel.addEventListener('open', onOpen)
      channel.addEventListener('error', onFail)
      channel.addEventListener('close', onFail)
      pc.addEventListener('connectionstatechange', onState)

      if (channel.readyState === 'open') done(true)
    })
  }

  private async pushFileOverChannel(
    channel: RTCDataChannel,
    opts: { transferId: string; activityId: string; file: File },
  ) {
    const header: HeaderMessage = {
      type: 'header',
      transferId: opts.transferId,
      activityId: opts.activityId,
      fileName: opts.file.name,
      fileSize: opts.file.size,
      mimeType: opts.file.type || 'application/octet-stream',
    }
    channel.send(JSON.stringify(header))

    const buffer = await opts.file.arrayBuffer()
    const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE) || 1

    for (let i = 0; i < totalChunks; i++) {
      while (channel.bufferedAmount > BUFFER_LOW) {
        await new Promise<void>((resolve) => {
          const onLow = () => {
            channel.removeEventListener('bufferedamountlow', onLow)
            resolve()
          }
          channel.addEventListener('bufferedamountlow', onLow)
        })
      }

      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, buffer.byteLength)
      const slice = buffer.slice(start, end)
      // Prefix 4-byte big-endian chunk index
      const packet = new Uint8Array(4 + slice.byteLength)
      const view = new DataView(packet.buffer)
      view.setUint32(0, i)
      packet.set(new Uint8Array(slice), 4)
      channel.send(packet.buffer)

      if (i % 8 === 0) {
        this.onProgress?.({
          transferId: opts.transferId,
          activityId: opts.activityId,
          progress: (i + 1) / totalChunks,
          status: 'transferring',
        })
      }
    }

    const done: DoneMessage = {
      type: 'done',
      transferId: opts.transferId,
      totalChunks,
    }
    channel.send(JSON.stringify(done))
  }

  private async handleOffer(msg: FileSignalMessage) {
    if (!this.selfId) return
    const payload = msg.payload as {
      sdp: RTCSessionDescriptionInit
      transferId: string
      activityId: string
    }

    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    const transferId = payload.transferId

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return
      this.emitSignal('file-ice-candidate', msg.senderParticipantId, ev.candidate.toJSON())
    }

    pc.ondatachannel = (ev) => {
      const channel = ev.channel
      channel.binaryType = 'arraybuffer'
      channel.onmessage = (message) => {
        void this.onIncomingMessage(message.data, msg.senderParticipantId, pc)
      }
      channel.onclose = () => {
        const state = this.incoming.get(transferId)
        if (state && state.received < state.fileSize) {
          this.failIncoming(transferId, 'Peer disconnected')
        }
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        const state = this.incoming.get(transferId)
        if (state && state.received < state.fileSize) {
          this.failIncoming(transferId, 'Connection lost')
        }
      }
    }

    await pc.setRemoteDescription(payload.sdp)

    const pendingKey = `pending:${msg.senderParticipantId}`
    const queued = this.pendingCandidates.get(pendingKey) ?? []
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c)
      } catch {
        // ignore
      }
    }
    this.pendingCandidates.delete(pendingKey)

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    this.emitSignal('file-answer', msg.senderParticipantId, {
      sdp: pc.localDescription,
      transferId,
    })
  }

  private async handleAnswer(msg: FileSignalMessage) {
    const payload = msg.payload as { sdp: RTCSessionDescriptionInit; transferId: string }
    const peer = this.outgoing.get(this.key(payload.transferId, msg.senderParticipantId))
    if (!peer) return
    await peer.pc.setRemoteDescription(payload.sdp)
  }

  private async handleRemoteCandidate(msg: FileSignalMessage) {
    const candidate = msg.payload as RTCIceCandidateInit
    // Try outgoing first (answer side sends to offerer)
    for (const [k, peer] of this.outgoing) {
      if (peer.peerId === msg.senderParticipantId) {
        try {
          await peer.pc.addIceCandidate(candidate)
        } catch {
          // ignore
        }
        if (candidate.candidate?.includes(' typ relay ')) peer.usedRelay = true
        return
      }
      void k
    }

    // Incoming: may arrive before remote description is set
    const transferHint = [...this.incoming.values()].find((s) => s.peerId === msg.senderParticipantId)
    if (transferHint) {
      try {
        await transferHint.pc.addIceCandidate(candidate)
      } catch {
        const qKey = this.key(transferHint.transferId, msg.senderParticipantId)
        const list = this.pendingCandidates.get(qKey) ?? []
        list.push(candidate)
        this.pendingCandidates.set(qKey, list)
      }
      return
    }

    // Queue under unknown transfer until offer arrives — use peer-only key bucket
    const qKey = `pending:${msg.senderParticipantId}`
    const list = this.pendingCandidates.get(qKey) ?? []
    list.push(candidate)
    this.pendingCandidates.set(qKey, list)
  }

  private async onIncomingMessage(
    data: ArrayBuffer | string,
    peerId: string,
    pc: RTCPeerConnection,
  ) {
    if (typeof data === 'string') {
      let msg: ControlMessage
      try {
        msg = JSON.parse(data) as ControlMessage
      } catch {
        return
      }

      if (msg.type === 'header') {
        this.incoming.set(msg.transferId, {
          transferId: msg.transferId,
          activityId: msg.activityId,
          fileName: msg.fileName,
          fileSize: msg.fileSize,
          mimeType: msg.mimeType,
          chunks: [],
          received: 0,
          pc,
          peerId,
        })
        this.onProgress?.({
          transferId: msg.transferId,
          activityId: msg.activityId,
          progress: 0,
          status: 'transferring',
        })

        // flush pending candidates for this peer
        const pendingKey = `pending:${peerId}`
        const queued = this.pendingCandidates.get(pendingKey) ?? []
        for (const c of queued) {
          try {
            await pc.addIceCandidate(c)
          } catch {
            // ignore
          }
        }
        this.pendingCandidates.delete(pendingKey)
        return
      }

      if (msg.type === 'done') {
        const state = this.incoming.get(msg.transferId)
        if (!state) return
        this.finalizeIncoming(state)
      }
      return
    }

    // Binary chunk: 4-byte index + payload
    const view = new DataView(data)
    if (data.byteLength < 4) return
    const index = view.getUint32(0)
    const payload = data.slice(4)

    // Find active incoming for this pc
    const state = [...this.incoming.values()].find((s) => s.pc === pc)
    if (!state) return

    state.chunks[index] = payload
    state.received += payload.byteLength
    const progress = state.fileSize > 0 ? Math.min(1, state.received / state.fileSize) : 1
    this.onProgress?.({
      transferId: state.transferId,
      activityId: state.activityId,
      progress,
      status: 'transferring',
    })
  }

  private finalizeIncoming(state: IncomingState) {
    const blob = new Blob(state.chunks.filter(Boolean), { type: state.mimeType })
    if (state.fileSize > 0 && blob.size !== state.fileSize) {
      this.failIncoming(state.transferId, 'Incomplete file')
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    this.onProgress?.({
      transferId: state.transferId,
      activityId: state.activityId,
      progress: 1,
      status: 'complete',
      transferPath: 'direct',
      objectUrl,
    })
    try {
      state.pc.close()
    } catch {
      // ignore
    }
    this.incoming.delete(state.transferId)
  }

  private failIncoming(transferId: string, error: string) {
    const state = this.incoming.get(transferId)
    if (!state) return
    this.onProgress?.({
      transferId,
      activityId: state.activityId,
      progress: state.fileSize > 0 ? state.received / state.fileSize : 0,
      status: 'failed',
      error,
    })
    try {
      state.pc.close()
    } catch {
      // ignore
    }
    this.incoming.delete(transferId)
  }

  private closeOutgoing(mapKey: string) {
    const peer = this.outgoing.get(mapKey)
    if (!peer) return
    try {
      peer.channel.close()
    } catch {
      // ignore
    }
    try {
      peer.pc.close()
    } catch {
      // ignore
    }
    this.outgoing.delete(mapKey)
  }

  /** Mark in-flight transfers from/to a peer as failed (e.g. participant left). */
  handlePeerLeft(peerId: string) {
    for (const [key, peer] of [...this.outgoing]) {
      if (peer.peerId === peerId) {
        const transferId = key.split(':')[0]
        this.closeOutgoing(key)
        this.onProgress?.({
          transferId,
          activityId: '',
          progress: 0,
          status: 'failed',
          error: 'Peer left',
        })
      }
    }
    for (const [transferId, state] of [...this.incoming]) {
      if (state.peerId === peerId) {
        this.failIncoming(transferId, 'Peer left')
      }
    }
  }

  dispose() {
    for (const key of [...this.outgoing.keys()]) this.closeOutgoing(key)
    for (const id of [...this.incoming.keys()]) this.failIncoming(id, 'Disposed')
    this.socket?.off('file-offer')
    this.socket?.off('file-answer')
    this.socket?.off('file-ice-candidate')
  }
}

export const fileTransferManager = new FileTransferManager()
