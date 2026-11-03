import { getIceServers } from "./api";
const MAX_MESH_PARTICIPANTS = 6;
function createBlackVideoTrack() {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#0b0e11";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const stream = canvas.captureStream(5);
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("Could not create placeholder video track");
  track.contentHint = "motion";
  return track;
}
class MeetingWebRTCManager {
  selfId = null;
  socket = null;
  iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  iceServersReady = null;
  peers = /* @__PURE__ */ new Map();
  pendingCandidates = /* @__PURE__ */ new Map();
  localStream = null;
  /** Outbound video currently pushed to peers (camera, screen, or black placeholder). */
  outboundVideoTrack = null;
  placeholderVideoTrack = null;
  remoteStreams = /* @__PURE__ */ new Map();
  onRemoteStream = null;
  onMeshError = null;
  signalPrefix = "meeting";
  makingOffer = /* @__PURE__ */ new Set();
  configure(opts) {
    this.selfId = opts.selfId;
    this.socket = opts.socket;
    this.iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    this.onRemoteStream = opts.onRemoteStream;
    this.onMeshError = opts.onMeshError ?? null;
    this.signalPrefix = opts.signalPrefix ?? "meeting";
    this.bindSocket();
    this.iceServersReady = this.refreshIceServers();
  }
  async refreshIceServers() {
    try {
      const { iceServers } = await getIceServers();
      if (iceServers?.length) this.iceServers = iceServers;
    } catch {
    }
  }
  bindSocket() {
    if (!this.socket) return;
    this.socket.off(`${this.signalPrefix}-offer`);
    this.socket.off(`${this.signalPrefix}-answer`);
    this.socket.off(`${this.signalPrefix}-ice-candidate`);
    this.socket.on(`${this.signalPrefix}-offer`, (msg) => {
      if (msg.targetParticipantId !== this.selfId) return;
      void this.handleOffer(msg);
    });
    this.socket.on(`${this.signalPrefix}-answer`, (msg) => {
      if (msg.targetParticipantId !== this.selfId) return;
      void this.handleAnswer(msg);
    });
    this.socket.on(`${this.signalPrefix}-ice-candidate`, (msg) => {
      if (msg.targetParticipantId !== this.selfId) return;
      void this.handleRemoteCandidate(msg);
    });
  }
  emitSignal(event, targetParticipantId, payload) {
    if (!this.socket || !this.selfId) return;
    this.socket.emit(event, {
      targetParticipantId,
      senderParticipantId: this.selfId,
      payload
    });
  }
  shouldOffer(peerId) {
    if (!this.selfId) return false;
    return this.selfId > peerId;
  }
  ensurePlaceholder() {
    if (!this.placeholderVideoTrack || this.placeholderVideoTrack.readyState === "ended") {
      this.placeholderVideoTrack = createBlackVideoTrack();
    }
    return this.placeholderVideoTrack;
  }
  videoTrackForSend(stream) {
    const cam = stream?.getVideoTracks().find((t) => t.readyState === "live" && t.enabled) ?? null;
    if (cam) return cam;
    const anyCam = stream?.getVideoTracks()[0] ?? null;
    if (anyCam && anyCam.readyState === "live") return anyCam;
    return this.ensurePlaceholder();
  }
  setLocalStream(stream) {
    this.localStream = stream;
    if (this.outboundVideoTrack?.getSettings().displaySurface) {
      for (const { pc } of this.peers.values()) {
        this.syncAudioSender(pc, stream);
      }
      return;
    }
    this.outboundVideoTrack = this.videoTrackForSend(stream);
    for (const { pc } of this.peers.values()) {
      this.syncSenders(pc, stream, this.outboundVideoTrack);
    }
  }
  findSender(pc, kind) {
    const withTrack = pc.getSenders().find((s) => s.track?.kind === kind);
    if (withTrack) return withTrack;
    const byTransceiver = pc.getTransceivers().find((t) => {
      if (t.sender.track?.kind === kind) return true;
      if (t.receiver.track?.kind === kind) return true;
      return false;
    });
    if (byTransceiver) return byTransceiver.sender;
    const idx = kind === "audio" ? 0 : 1;
    return pc.getTransceivers()[idx]?.sender ?? null;
  }
  syncAudioSender(pc, stream) {
    const audioTrack = stream?.getAudioTracks()[0] ?? null;
    const sender = this.findSender(pc, "audio");
    if (sender) void sender.replaceTrack(audioTrack);
    else if (audioTrack && stream) pc.addTrack(audioTrack, stream);
  }
  syncSenders(pc, stream, videoTrack) {
    this.syncAudioSender(pc, stream);
    const sender = this.findSender(pc, "video");
    if (sender) void sender.replaceTrack(videoTrack);
    else if (videoTrack) {
      const ms = stream ?? new MediaStream([videoTrack]);
      if (!stream) ms.addTrack(videoTrack);
      pc.addTrack(videoTrack, ms);
    }
  }
  /** Replace outbound video on every peer (camera ↔ screen ↔ placeholder). */
  async replaceVideoTrack(track) {
    const next = track ?? this.videoTrackForSend(this.localStream);
    if (track) {
      try {
        track.contentHint = track.getSettings().displaySurface ? "detail" : "motion";
      } catch {
      }
    }
    this.outboundVideoTrack = next;
    const tasks = [];
    for (const { pc } of this.peers.values()) {
      const sender = this.findSender(pc, "video");
      if (sender) {
        tasks.push(
          sender.replaceTrack(next).then(() => void 0).catch(() => void 0)
        );
      } else if (next) {
        pc.addTrack(next, this.localStream ?? new MediaStream([next]));
      }
    }
    await Promise.all(tasks);
  }
  setAudioEnabled(enabled) {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = enabled;
    });
    for (const { pc } of this.peers.values()) {
      const sender = this.findSender(pc, "audio");
      if (sender?.track) sender.track.enabled = enabled;
    }
  }
  async syncPeers(remoteParticipantIds) {
    await this.iceServersReady;
    const unique = [...new Set(remoteParticipantIds)].filter((id) => id && id !== this.selfId);
    const total = unique.length + 1;
    if (total > MAX_MESH_PARTICIPANTS) {
      const msg = `This meeting supports at most ${MAX_MESH_PARTICIPANTS} participants.`;
      this.onMeshError?.(msg);
      return { ok: false, error: msg };
    }
    for (const id of [...this.peers.keys()]) {
      if (!unique.includes(id)) this.closePeer(id);
    }
    for (const peerId of unique) {
      if (!this.peers.has(peerId) && this.shouldOffer(peerId)) {
        await this.createAndOffer(peerId);
      } else if (!this.peers.has(peerId)) {
        this.ensurePeerShell(peerId, { addOutbound: true });
      }
    }
    return { ok: true };
  }
  ensurePeerShell(peerId, opts) {
    const existing = this.peers.get(peerId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = { pc, peerId };
    this.peers.set(peerId, peer);
    this.wirePc(peer);
    if (opts.addOutbound) {
      const audio = this.localStream?.getAudioTracks()[0];
      const video = this.outboundVideoTrack ?? this.videoTrackForSend(this.localStream);
      this.outboundVideoTrack = video;
      if (audio && this.localStream) pc.addTrack(audio, this.localStream);
      else pc.addTransceiver("audio", { direction: "sendrecv" });
      const videoStream = this.localStream ?? new MediaStream([video]);
      if (!this.localStream) videoStream.addTrack(video);
      pc.addTrack(video, videoStream);
    }
    return peer;
  }
  wirePc(peer) {
    const { pc, peerId } = peer;
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      this.emitSignal(`${this.signalPrefix}-ice-candidate`, peerId, ev.candidate.toJSON());
    };
    pc.ontrack = (ev) => {
      let stream = this.remoteStreams.get(peerId);
      if (!stream) {
        stream = ev.streams[0] ?? new MediaStream();
        this.remoteStreams.set(peerId, stream);
      }
      if (!stream.getTracks().some((t) => t.id === ev.track.id)) {
        stream.getTracks().forEach((t) => {
          if (t.kind === ev.track.kind) {
            stream.removeTrack(t);
          }
        });
        stream.addTrack(ev.track);
      }
      const publish = () => this.onRemoteStream?.(peerId, stream);
      publish();
      ev.track.onunmute = publish;
      ev.track.onmute = publish;
      ev.track.onended = () => {
        stream?.removeTrack(ev.track);
        publish();
      };
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.remoteStreams.delete(peerId);
        this.onRemoteStream?.(peerId, null);
      }
    };
  }
  async createAndOffer(peerId) {
    if (this.makingOffer.has(peerId)) return;
    this.makingOffer.add(peerId);
    try {
      await this.iceServersReady;
      const peer = this.ensurePeerShell(peerId, { addOutbound: true });
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.emitSignal(`${this.signalPrefix}-offer`, peerId, { sdp: peer.pc.localDescription });
    } catch {
      this.closePeer(peerId);
    } finally {
      this.makingOffer.delete(peerId);
    }
  }
  async handleOffer(msg) {
    await this.iceServersReady;
    const payload = msg.payload;
    const peerId = msg.senderParticipantId;
    let peer = this.peers.get(peerId);
    if (!peer) {
      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      peer = { pc, peerId };
      this.peers.set(peerId, peer);
      this.wirePc(peer);
    }
    await peer.pc.setRemoteDescription(payload.sdp);
    await this.flushCandidates(peerId, peer.pc);
    const audio = this.localStream?.getAudioTracks()[0] ?? null;
    const video = this.outboundVideoTrack ?? this.videoTrackForSend(this.localStream);
    this.outboundVideoTrack = video;
    const audioSender = this.findSender(peer.pc, "audio");
    const videoSender = this.findSender(peer.pc, "video");
    if (audioSender) await audioSender.replaceTrack(audio);
    else if (audio && this.localStream) peer.pc.addTrack(audio, this.localStream);
    if (videoSender) await videoSender.replaceTrack(video);
    else {
      const vs = this.localStream ?? new MediaStream([video]);
      peer.pc.addTrack(video, vs);
    }
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    this.emitSignal(`${this.signalPrefix}-answer`, peerId, { sdp: peer.pc.localDescription });
  }
  async handleAnswer(msg) {
    const payload = msg.payload;
    const peer = this.peers.get(msg.senderParticipantId);
    if (!peer) return;
    await peer.pc.setRemoteDescription(payload.sdp);
    await this.flushCandidates(msg.senderParticipantId, peer.pc);
  }
  async handleRemoteCandidate(msg) {
    const candidate = msg.payload;
    const peerId = msg.senderParticipantId;
    const peer = this.peers.get(peerId);
    if (!peer || !peer.pc.remoteDescription) {
      const list = this.pendingCandidates.get(peerId) ?? [];
      list.push(candidate);
      this.pendingCandidates.set(peerId, list);
      return;
    }
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch {
    }
  }
  async flushCandidates(peerId, pc) {
    const queued = this.pendingCandidates.get(peerId) ?? [];
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c);
      } catch {
      }
    }
    this.pendingCandidates.delete(peerId);
  }
  closePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    try {
      peer.pc.close();
    } catch {
    }
    this.peers.delete(peerId);
    this.pendingCandidates.delete(peerId);
    this.remoteStreams.delete(peerId);
    this.onRemoteStream?.(peerId, null);
  }
  dispose() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.socket?.off(`${this.signalPrefix}-offer`);
    this.socket?.off(`${this.signalPrefix}-answer`);
    this.socket?.off(`${this.signalPrefix}-ice-candidate`);
    this.placeholderVideoTrack?.stop();
    this.placeholderVideoTrack = null;
    this.outboundVideoTrack = null;
    this.localStream = null;
    this.selfId = null;
    this.iceServersReady = null;
  }
}
const meetingWebRTC = new MeetingWebRTCManager();
export {
  MAX_MESH_PARTICIPANTS,
  MeetingWebRTCManager,
  meetingWebRTC
};
