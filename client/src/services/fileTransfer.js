import { getIceServers, recordTransferStat, uploadFallbackFile } from "./api";
const CHUNK_SIZE = 16 * 1024;
const BUFFER_LOW = 256 * 1024;
const CONNECT_TIMEOUT_MS = 8e3;
class FileTransferManager {
  selfId = null;
  socket = null;
  onProgress = null;
  iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  outgoing = /* @__PURE__ */ new Map();
  // key: `${transferId}:${peerId}`
  incoming = /* @__PURE__ */ new Map();
  // key: transferId
  pendingCandidates = /* @__PURE__ */ new Map();
  configure(opts) {
    this.selfId = opts.selfId;
    this.socket = opts.socket;
    this.onProgress = opts.onProgress;
    this.bindSocket();
    void this.refreshIceServers();
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
    this.socket.off("file-offer");
    this.socket.off("file-answer");
    this.socket.off("file-ice-candidate");
    this.socket.on("file-offer", (msg) => {
      if (msg.targetParticipantId !== this.selfId) return;
      void this.handleOffer(msg);
    });
    this.socket.on("file-answer", (msg) => {
      if (msg.targetParticipantId !== this.selfId) return;
      void this.handleAnswer(msg);
    });
    this.socket.on("file-ice-candidate", (msg) => {
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
  key(transferId, peerId) {
    return `${transferId}:${peerId}`;
  }
  async sendFileToPeers(opts) {
    const { file, transferId, activityId, recipientIds } = opts;
    this.onProgress?.({
      transferId,
      activityId,
      progress: 0,
      status: "transferring"
    });
    try {
      const uploaded = await uploadFallbackFile(file);
      void recordTransferStat("storage");
      this.socket?.emit("file-transfer-complete", {
        activityId,
        transferId,
        downloadUrl: uploaded.downloadUrl,
        transferPath: "storage"
      });
      this.onProgress?.({
        transferId,
        activityId,
        progress: 1,
        status: "complete",
        transferPath: "storage",
        objectUrl: URL.createObjectURL(file),
        downloadUrl: uploaded.downloadUrl
      });
    } catch (err) {
      if (recipientIds.length === 0) {
        this.onProgress?.({
          transferId,
          activityId,
          progress: 1,
          status: "complete",
          transferPath: "direct",
          objectUrl: URL.createObjectURL(file)
        });
        return;
      }
      await this.refreshIceServers();
      const results = await Promise.all(
        recipientIds.map((peerId) => this.sendToPeer({ file, transferId, activityId, peerId }))
      );
      const anyOk = results.some((r) => r.ok);
      if (anyOk) {
        const usedRelay = results.some((r) => r.ok && r.path === "relay");
        const path = usedRelay ? "relay" : "direct";
        void recordTransferStat(path);
        this.onProgress?.({
          transferId,
          activityId,
          progress: 1,
          status: "complete",
          transferPath: path,
          objectUrl: URL.createObjectURL(file)
        });
        return;
      }
      this.onProgress?.({
        transferId,
        activityId,
        progress: 0,
        status: "failed",
        error: err instanceof Error ? err.message : "Transfer failed"
      });
    }
  }
  async sendToPeer(opts) {
    const { file, transferId, activityId, peerId } = opts;
    const mapKey = this.key(transferId, peerId);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const channel = pc.createDataChannel("file-transfer", { ordered: true });
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFER_LOW;
    const peer = { pc, channel, peerId, usedRelay: false };
    this.outgoing.set(mapKey, peer);
    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !this.selfId) return;
      if (ev.candidate.candidate.includes(" typ relay ")) peer.usedRelay = true;
      this.emitSignal("file-ice-candidate", peerId, ev.candidate.toJSON());
    };
    const connected = this.waitForChannelOpen(channel, pc, CONNECT_TIMEOUT_MS);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.emitSignal("file-offer", peerId, {
        sdp: pc.localDescription,
        transferId,
        activityId
      });
      const ok = await connected;
      if (!ok) {
        this.closeOutgoing(mapKey);
        return { ok: false };
      }
      await this.pushFileOverChannel(channel, {
        transferId,
        activityId,
        file
      });
      await new Promise((r) => setTimeout(r, 250));
      const path = peer.usedRelay ? "relay" : "direct";
      this.closeOutgoing(mapKey);
      return { ok: true, path };
    } catch {
      this.closeOutgoing(mapKey);
      return { ok: false };
    }
  }
  waitForChannelOpen(channel, pc, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const timer = window.setTimeout(() => done(false), timeoutMs);
      const onOpen = () => done(true);
      const onFail = () => done(false);
      const cleanup = () => {
        window.clearTimeout(timer);
        channel.removeEventListener("open", onOpen);
        channel.removeEventListener("error", onFail);
        channel.removeEventListener("close", onFail);
        pc.removeEventListener("connectionstatechange", onState);
      };
      const onState = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") done(false);
      };
      channel.addEventListener("open", onOpen);
      channel.addEventListener("error", onFail);
      channel.addEventListener("close", onFail);
      pc.addEventListener("connectionstatechange", onState);
      if (channel.readyState === "open") done(true);
    });
  }
  waitForBufferLow(channel) {
    if (channel.bufferedAmount <= BUFFER_LOW) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        channel.removeEventListener("bufferedamountlow", onLow);
        resolve();
      }, 5e3);
      const onLow = () => {
        window.clearTimeout(timer);
        channel.removeEventListener("bufferedamountlow", onLow);
        resolve();
      };
      channel.addEventListener("bufferedamountlow", onLow);
    });
  }
  async drainChannel(channel) {
    const start = Date.now();
    while (channel.bufferedAmount > 0 && Date.now() - start < 15e3) {
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  async pushFileOverChannel(channel, opts) {
    const header = {
      type: "header",
      transferId: opts.transferId,
      activityId: opts.activityId,
      fileName: opts.file.name,
      fileSize: opts.file.size,
      mimeType: opts.file.type || "application/octet-stream"
    };
    channel.send(JSON.stringify(header));
    const buffer = await opts.file.arrayBuffer();
    const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE) || 1;
    for (let i = 0; i < totalChunks; i++) {
      if (channel.readyState !== "open") {
        throw new Error("Data channel closed during transfer");
      }
      while (channel.bufferedAmount > BUFFER_LOW) {
        await this.waitForBufferLow(channel);
      }
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
      const slice = buffer.slice(start, end);
      const packet = new Uint8Array(4 + slice.byteLength);
      const view = new DataView(packet.buffer);
      view.setUint32(0, i);
      packet.set(new Uint8Array(slice), 4);
      channel.send(packet.buffer);
      if (i % 8 === 0) {
        this.onProgress?.({
          transferId: opts.transferId,
          activityId: opts.activityId,
          progress: (i + 1) / totalChunks,
          status: "transferring"
        });
      }
    }
    const done = {
      type: "done",
      transferId: opts.transferId,
      totalChunks
    };
    channel.send(JSON.stringify(done));
    await this.drainChannel(channel);
  }
  async handleOffer(msg) {
    if (!this.selfId) return;
    const payload = msg.payload;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const transferId = payload.transferId;
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      this.emitSignal("file-ice-candidate", msg.senderParticipantId, ev.candidate.toJSON());
    };
    pc.ondatachannel = (ev) => {
      const channel = ev.channel;
      channel.binaryType = "arraybuffer";
      channel.onmessage = (message) => {
        void this.onIncomingMessage(message.data, msg.senderParticipantId, pc);
      };
      channel.onclose = () => {
        const state = this.incoming.get(transferId);
        if (state && state.received < state.fileSize) {
          this.failIncoming(transferId, "Peer disconnected");
        }
      };
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        const state = this.incoming.get(transferId);
        if (state && state.received < state.fileSize) {
          this.failIncoming(transferId, "Connection lost");
        }
      }
    };
    await pc.setRemoteDescription(payload.sdp);
    const pendingKey = `pending:${msg.senderParticipantId}`;
    const queued = this.pendingCandidates.get(pendingKey) ?? [];
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c);
      } catch {
      }
    }
    this.pendingCandidates.delete(pendingKey);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.emitSignal("file-answer", msg.senderParticipantId, {
      sdp: pc.localDescription,
      transferId
    });
  }
  async handleAnswer(msg) {
    const payload = msg.payload;
    const peer = this.outgoing.get(this.key(payload.transferId, msg.senderParticipantId));
    if (!peer) return;
    await peer.pc.setRemoteDescription(payload.sdp);
    const qKey = this.key(payload.transferId, msg.senderParticipantId);
    const queued = this.pendingCandidates.get(qKey) ?? [];
    for (const c of queued) {
      try {
        await peer.pc.addIceCandidate(c);
      } catch {
      }
    }
    this.pendingCandidates.delete(qKey);
  }
  async handleRemoteCandidate(msg) {
    const candidate = msg.payload;
    for (const [k, peer] of this.outgoing) {
      if (peer.peerId !== msg.senderParticipantId) continue;
      if (!peer.pc.remoteDescription) {
        const list2 = this.pendingCandidates.get(k) ?? [];
        list2.push(candidate);
        this.pendingCandidates.set(k, list2);
        return;
      }
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch {
      }
      if (candidate.candidate?.includes(" typ relay ")) peer.usedRelay = true;
      return;
    }
    const transferHint = [...this.incoming.values()].find((s) => s.peerId === msg.senderParticipantId);
    if (transferHint) {
      if (!transferHint.pc.remoteDescription) {
        const qKey2 = `pending:${msg.senderParticipantId}`;
        const list2 = this.pendingCandidates.get(qKey2) ?? [];
        list2.push(candidate);
        this.pendingCandidates.set(qKey2, list2);
        return;
      }
      try {
        await transferHint.pc.addIceCandidate(candidate);
      } catch {
      }
      return;
    }
    const qKey = `pending:${msg.senderParticipantId}`;
    const list = this.pendingCandidates.get(qKey) ?? [];
    list.push(candidate);
    this.pendingCandidates.set(qKey, list);
  }
  async onIncomingMessage(data, peerId, pc) {
    if (data instanceof Blob) {
      data = await data.arrayBuffer();
    }
    if (typeof data === "string") {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.type === "header") {
        this.incoming.set(msg.transferId, {
          transferId: msg.transferId,
          activityId: msg.activityId,
          fileName: msg.fileName,
          fileSize: msg.fileSize,
          mimeType: msg.mimeType,
          chunks: [],
          received: 0,
          pc,
          peerId
        });
        this.onProgress?.({
          transferId: msg.transferId,
          activityId: msg.activityId,
          progress: 0,
          status: "transferring"
        });
        const pendingKey = `pending:${peerId}`;
        const queued = this.pendingCandidates.get(pendingKey) ?? [];
        for (const c of queued) {
          try {
            await pc.addIceCandidate(c);
          } catch {
          }
        }
        this.pendingCandidates.delete(pendingKey);
        return;
      }
      if (msg.type === "done") {
        const state2 = this.incoming.get(msg.transferId);
        if (!state2) return;
        this.finalizeIncoming(state2);
      }
      return;
    }
    const view = new DataView(data);
    if (data.byteLength < 4) return;
    const index = view.getUint32(0);
    const payload = data.slice(4);
    const state = [...this.incoming.values()].find((s) => s.pc === pc);
    if (!state) return;
    state.chunks[index] = payload;
    state.received += payload.byteLength;
    const progress = state.fileSize > 0 ? Math.min(1, state.received / state.fileSize) : 1;
    this.onProgress?.({
      transferId: state.transferId,
      activityId: state.activityId,
      progress,
      status: "transferring"
    });
  }
  finalizeIncoming(state) {
    const blob = new Blob(state.chunks.filter(Boolean), { type: state.mimeType });
    if (state.fileSize > 0 && blob.size !== state.fileSize) {
      this.failIncoming(state.transferId, "Incomplete file");
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    this.onProgress?.({
      transferId: state.transferId,
      activityId: state.activityId,
      progress: 1,
      status: "complete",
      transferPath: "direct",
      objectUrl
    });
    try {
      state.pc.close();
    } catch {
    }
    this.incoming.delete(state.transferId);
  }
  failIncoming(transferId, error) {
    const state = this.incoming.get(transferId);
    if (!state) return;
    this.onProgress?.({
      transferId,
      activityId: state.activityId,
      progress: state.fileSize > 0 ? state.received / state.fileSize : 0,
      status: "failed",
      error
    });
    try {
      state.pc.close();
    } catch {
    }
    this.incoming.delete(transferId);
  }
  closeOutgoing(mapKey) {
    const peer = this.outgoing.get(mapKey);
    if (!peer) return;
    try {
      peer.channel.close();
    } catch {
    }
    try {
      peer.pc.close();
    } catch {
    }
    this.outgoing.delete(mapKey);
  }
  /** Mark in-flight transfers from/to a peer as failed (e.g. participant left). */
  handlePeerLeft(peerId) {
    for (const [key, peer] of [...this.outgoing]) {
      if (peer.peerId === peerId) {
        const transferId = key.split(":")[0];
        this.closeOutgoing(key);
        this.onProgress?.({
          transferId,
          activityId: "",
          progress: 0,
          status: "failed",
          error: "Peer left"
        });
      }
    }
    for (const [transferId, state] of [...this.incoming]) {
      if (state.peerId === peerId) {
        this.failIncoming(transferId, "Peer left");
      }
    }
  }
  dispose() {
    for (const key of [...this.outgoing.keys()]) this.closeOutgoing(key);
    for (const id of [...this.incoming.keys()]) this.failIncoming(id, "Disposed");
    this.socket?.off("file-offer");
    this.socket?.off("file-answer");
    this.socket?.off("file-ice-candidate");
  }
}
const fileTransferManager = new FileTransferManager();
export {
  FileTransferManager,
  fileTransferManager
};
