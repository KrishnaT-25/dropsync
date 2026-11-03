import { Camera, CameraOff, Maximize2, Mic, MicOff, Minimize2, MonitorUp, PhoneOff, Video, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "../../services/socket";
import { MeetingWebRTCManager } from "../../services/meetingWebRTC";

function VideoFrame({ stream, label, muted = false }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream || null;
    if (stream) void videoRef.current.play().catch(() => {});
  }, [stream]);
  return <div className="ds-call-frame"><video ref={videoRef} autoPlay playsInline muted={muted} /><span>{label}</span></div>;
}

function callAck(socket, event, payload = {}) {
  return new Promise((resolve) => socket.timeout(10000).emit(event, payload, (error, result) => resolve(error ? { ok: false, error: "Call connection timed out" } : result ?? { ok: false, error: "No call response" })));
}

export function RoomCallDock({ code, participantId, creatorId, connected, open, compact, onCompact, onExpand, onClose }) {
  const socket = getSocket();
  const rtcRef = useRef(null);
  const localRef = useRef(null);
  const screenRef = useRef(null);
  const joinedRef = useRef(false);
  const joinRef = useRef(null);
  const [participants, setParticipants] = useState([]);
  const [waitingPeople, setWaitingPeople] = useState([]);
  const [permissions, setPermissions] = useState({ requireAdmission: false, allowScreenShare: true, allowParticipantUnmute: true });
  const [coHostIds, setCoHostIds] = useState([]);
  const [forcedMutedIds, setForcedMutedIds] = useState([]);
  const [waiting, setWaiting] = useState(false);
  const [forcedMuted, setForcedMuted] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [joined, setJoined] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const publishMedia = (mic, camera) => socket.emit("room-call-media", { micEnabled: mic, cameraEnabled: camera });
  const updateState = useCallback((state) => {
    setParticipants(state.participants ?? []);
    setWaitingPeople(state.waiting ?? []);
    if (state.permissions) setPermissions(state.permissions);
    setCoHostIds(state.coHostIds ?? []);
    setForcedMutedIds(state.forcedMutedIds ?? []);
  }, []);

  const stopLocal = useCallback(() => {
    joinedRef.current = false;
    rtcRef.current?.dispose();
    rtcRef.current = null;
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null;
    setScreenStream(null);
    localRef.current?.getTracks().forEach((track) => track.stop());
    localRef.current = null;
    setLocalStream(null);
    setRemoteStreams({});
    setJoined(false);
  }, []);

  useEffect(() => {
    const onState = (state) => {
      if (state.code !== code) return;
      updateState(state);
      if (joinedRef.current) void rtcRef.current?.syncPeers(state.participants.filter((person) => person.participantId !== participantId).map((person) => person.participantId));
    };
    const onEnded = () => { socket.emit("room-call-leave"); stopLocal(); setParticipants([]); setWaiting(false); };
    const onDisconnect = () => { stopLocal(); setParticipants([]); setWaiting(false); };
    const onAdmitted = () => { setWaiting(false); void joinRef.current?.(); };
    const onDenied = () => { socket.emit("room-call-leave"); setWaiting(false); setError("The host did not admit you to this call."); };
    const onForcedMute = ({ muted }) => {
      setForcedMuted(muted);
      if (muted) {
        localRef.current?.getAudioTracks().forEach((track) => { track.enabled = false; });
        rtcRef.current?.setAudioEnabled(false);
        setMicEnabled(false);
        socket.emit("room-call-media", { micEnabled: false, cameraEnabled: localRef.current?.getVideoTracks().some((track) => track.enabled) ?? false });
      }
    };
    socket.on("room-call-state", onState);
    socket.on("room-call-ended", onEnded);
    socket.on("room-call-admitted", onAdmitted);
    socket.on("room-call-denied", onDenied);
    socket.on("room-call-force-muted", onForcedMute);
    socket.on("disconnect", onDisconnect);
    if (connected) void callAck(socket, "room-call-status").then((result) => { if (result.ok) updateState(result); });
    return () => {
      socket.off("room-call-state", onState);
      socket.off("room-call-ended", onEnded);
      socket.off("room-call-admitted", onAdmitted);
      socket.off("room-call-denied", onDenied);
      socket.off("room-call-force-muted", onForcedMute);
      socket.off("disconnect", onDisconnect);
    };
  }, [code, connected, participantId, socket, stopLocal, updateState]);
  useEffect(() => () => { if (joinedRef.current) socket.emit("room-call-leave"); stopLocal(); }, [socket, stopLocal]);
  useEffect(() => {
    if (!joined || participantId === creatorId || permissions.allowParticipantUnmute || !micEnabled) return;
    localRef.current?.getAudioTracks().forEach((track) => { track.enabled = false; });
    rtcRef.current?.setAudioEnabled(false);
    setMicEnabled(false);
    socket.emit("room-call-media", { micEnabled: false, cameraEnabled });
  }, [joined, participantId, creatorId, permissions.allowParticipantUnmute, micEnabled, cameraEnabled, socket]);

  const join = async () => {
    if (!connected || busy || joined) return;
    setBusy(true); setError("");
    let media;
    try {
      try { media = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); }
      catch { media = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
      const rtc = new MeetingWebRTCManager();
      rtc.configure({ selfId: participantId, socket, signalPrefix: "room-call", onRemoteStream: (id, stream) => setRemoteStreams((current) => {
        const next = { ...current };
        if (stream) next[id] = stream;
        else delete next[id];
        return next;
      }), onMeshError: setError });
      rtc.setLocalStream(media);
      rtcRef.current = rtc;
      const result = await callAck(socket, "room-call-join");
      if (!result.ok) throw new Error(result.error || "Could not join call");
      if (result.waiting) {
        media.getTracks().forEach((track) => track.stop());
        stopLocal();
        setWaiting(true);
        return;
      }
      localRef.current = media;
      joinedRef.current = true;
      setLocalStream(media);
      setJoined(true);
      const canSpeak = !(result.forcedMutedIds ?? []).includes(participantId) && (result.permissions?.allowParticipantUnmute !== false || participantId === creatorId);
      media.getAudioTracks().forEach((track) => { track.enabled = canSpeak; });
      rtc.setAudioEnabled(canSpeak);
      setMicEnabled(canSpeak);
      setForcedMuted((result.forcedMutedIds ?? []).includes(participantId));
      const hasCamera = media.getVideoTracks().length > 0;
      setCameraEnabled(hasCamera);
      publishMedia(canSpeak, hasCamera);
      updateState(result);
      await rtc.syncPeers(result.participants.filter((person) => person.participantId !== participantId).map((person) => person.participantId));
      onExpand();
    } catch (cause) {
      media?.getTracks().forEach((track) => track.stop());
      socket.emit("room-call-leave");
      stopLocal();
      setError(cause instanceof Error ? cause.message : "Camera or microphone is unavailable");
    } finally { setBusy(false); }
  };
  joinRef.current = join;
  const leave = () => { socket.emit("room-call-leave"); stopLocal(); setWaiting(false); onClose(); };
  const toggleMic = () => {
    if (!micEnabled && (forcedMuted || !permissions.allowParticipantUnmute && participantId !== creatorId)) return;
    const next = !micEnabled;
    localRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
    rtcRef.current?.setAudioEnabled(next);
    setMicEnabled(next); publishMedia(next, cameraEnabled);
  };
  const toggleCamera = () => {
    const next = !cameraEnabled;
    localRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCameraEnabled(next); publishMedia(micEnabled, next);
    if (!next) void rtcRef.current?.replaceVideoTrack(null);
    else void rtcRef.current?.replaceVideoTrack(localRef.current?.getVideoTracks()[0] ?? null);
  };
  const shareScreen = async () => {
    if (!permissions.allowScreenShare && participantId !== creatorId) return;
    if (screenRef.current) {
      screenRef.current.getTracks().forEach((track) => track.stop());
      screenRef.current = null;
      setScreenStream(null);
      await rtcRef.current?.replaceVideoTrack(null);
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenRef.current = screen;
      setScreenStream(screen);
      const track = screen.getVideoTracks()[0];
      track.onended = () => { screenRef.current = null; setScreenStream(null); void rtcRef.current?.replaceVideoTrack(null); };
      await rtcRef.current?.replaceVideoTrack(track);
    } catch { /* The user cancelled screen selection. */ }
  };
  if (!open && !joined && participants.length === 0) return null;
  if (!open && !joined) return null;
  const visiblePeers = participants.filter((person) => person.participantId !== participantId);
  const isHost = participantId === creatorId;
  const isModerator = isHost || coHostIds.includes(participantId);
  const moderate = async (event, payload) => {
    const result = await callAck(socket, event, payload);
    if (!result.ok) setError(result.error || "Could not update call");
  };
  const changePermission = (name) => void moderate("room-call-permissions", { ...permissions, [name]: !permissions[name] });
  return <aside className={`ds-call-dock ${compact ? "compact" : ""}`} aria-label="Room call">
    <div className="ds-call-heading"><div><Video size={17} /><strong>Room call</strong><small>{participants.length ? `${participants.length} in call` : "No call yet"}</small></div><div className="ds-call-heading-actions">{joined && <button aria-label={compact ? "Expand video" : "Minimize video"} onClick={compact ? onExpand : onCompact}>{compact ? <Maximize2 size={16} /> : <Minimize2 size={16} />}</button>}<button aria-label="Close call panel" onClick={joined ? onCompact : onClose}><X size={16} /></button></div></div>
    {joined ? <><div className="ds-call-frames"><VideoFrame stream={screenStream || localStream} label="You" muted />{visiblePeers.map((person) => <VideoFrame key={person.participantId} stream={remoteStreams[person.participantId]} label={person.name} />)}</div><div className="ds-call-controls"><button aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"} disabled={!micEnabled && (forcedMuted || !permissions.allowParticipantUnmute && !isHost)} onClick={toggleMic}>{micEnabled ? <Mic size={17} /> : <MicOff size={17} />}</button><button aria-label={cameraEnabled ? "Turn off camera" : "Turn on camera"} onClick={toggleCamera}>{cameraEnabled ? <Camera size={17} /> : <CameraOff size={17} />}</button>{!compact && <button aria-label="Share screen" disabled={!permissions.allowScreenShare && !isHost} onClick={() => void shareScreen()}><MonitorUp size={17} /></button>}<button className="ds-call-hangup" aria-label="Leave call" onClick={leave}><PhoneOff size={17} /></button></div>{!compact && <div className="ds-call-members"><strong>In the call</strong>{visiblePeers.map((person) => <div key={person.participantId}><span>{person.name}{coHostIds.includes(person.participantId) ? " · Co-host" : ""}</span>{isModerator && person.participantId !== creatorId && <span className="ds-call-member-actions"><button onClick={() => void moderate("room-call-moderate", { targetParticipantId: person.participantId, action: "mute" })}>Mute</button><button onClick={() => void moderate("room-call-moderate", { targetParticipantId: person.participantId, action: "remove" })}>Remove</button>{isHost && <button onClick={() => void moderate("room-call-cohost", { targetParticipantId: person.participantId, enabled: !coHostIds.includes(person.participantId) })}>{coHostIds.includes(person.participantId) ? "Remove co-host" : "Make co-host"}</button>}</span>}</div>)}</div>}{!compact && isModerator && waitingPeople.length > 0 && <div className="ds-call-members"><strong>Waiting to join</strong>{waitingPeople.map((person) => <div key={person.participantId}><span>{person.name}</span><button onClick={() => void moderate("room-call-admit", { targetParticipantId: person.participantId })}>Admit</button></div>)}</div>}{!compact && isHost && <div className="ds-call-permissions"><strong>Call permissions</strong><label><input type="checkbox" checked={permissions.requireAdmission} onChange={() => changePermission("requireAdmission")} />Require admission</label><label><input type="checkbox" checked={permissions.allowScreenShare} onChange={() => changePermission("allowScreenShare")} />Allow screen sharing</label><label><input type="checkbox" checked={permissions.allowParticipantUnmute} onChange={() => changePermission("allowParticipantUnmute")} />Allow participants to unmute</label></div>}</> : <div className="ds-call-intro"><p>Talk without leaving this room. Chat and files stay available to everyone.</p>{waiting ? <button className="ds-secondary-button" onClick={leave}>Waiting for host · Cancel</button> : <button className="ds-primary-button" disabled={!connected || busy} onClick={() => void join()}>{busy ? "Connecting..." : participants.length ? "Join room call" : "Start room call"}</button>}</div>}
    {joined && !compact && isModerator && forcedMutedIds.length > 0 && <div className="ds-call-members"><strong>Muted by moderator</strong>{visiblePeers.filter((person) => forcedMutedIds.includes(person.participantId)).map((person) => <div key={person.participantId}><span>{person.name}</span><button onClick={() => void moderate("room-call-moderate", { targetParticipantId: person.participantId, action: "unmute" })}>Allow microphone</button></div>)}</div>}
    {joined && !compact && isModerator && waitingPeople.length > 0 && <div className="ds-call-members">{waitingPeople.map((person) => <div key={person.participantId}><span>{person.name}</span><button onClick={() => void moderate("room-call-deny", { targetParticipantId: person.participantId })}>Deny</button></div>)}</div>}
    {error && <p className="ds-call-error" role="alert">{error}</p>}
  </aside>;
}
