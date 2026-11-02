import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import * as api from "../services/api";
import * as socket from "../services/socket";
import { uploadRoomFile, getRoomFileDownload } from "../services/roomFiles";
import { applyRoomState, mapApiRoom, mergeActivity } from "../utils/roomMapper";

const RoomContext = createContext(null);
const STORAGE_KEY = "dropsync-room-grants";

function sessions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"); }
  catch { return {}; }
}
function stored(code) { return sessions()[code] ?? null; }
function saveStored(code, value) {
  const all = sessions();
  if (value) all[code] = { ...all[code], ...value };
  else delete all[code];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
function clearInvalidToken(code) {
  const previous = stored(code);
  saveStored(code, previous?.recoveryKey ? {
    participantId: null, accessToken: null, recoveryKey: previous.recoveryKey
  } : null);
}
function detectLink(content) { return /^https?:\/\//i.test(content) ? "link" : "message"; }

function RoomProvider({ children }) {
  const [room, setRoom] = useState(null);
  const [participantId, setParticipantId] = useState(null);
  const [connection, setConnection] = useState({ connected: false, error: null });
  const [isLoading, setIsLoading] = useState(false);
  const [rateLimitHint, setRateLimitHint] = useState(null);
  const [uploads, setUploads] = useState([]);
  const participantRef = useRef(null);
  const roomRef = useRef(null);
  useEffect(() => { participantRef.current = participantId; }, [participantId]);
  useEffect(() => { roomRef.current = room; }, [room]);

  const connectToRoom = useCallback(async (apiRoom, pid, token) => {
    const code = apiRoom.code;
    saveStored(code, { participantId: pid, accessToken: token });
    setParticipantId(pid);
    setRoom(mapApiRoom(apiRoom, pid));
    if (apiRoom.status !== "active") {
      socket.disconnectSocket();
      setConnection({ connected: false, error: null });
      return true;
    }
    const ack = await socket.joinRoomSocket(code, pid, token);
    if (!ack.ok || !ack.room) {
      setConnection({ connected: false, error: ack.error ?? "Could not connect to room" });
      return false;
    }
    setRoom((prev) => applyRoomState(prev, ack.room, pid));
    setConnection({ connected: true, error: null });
    return true;
  }, []);

  const refreshRoom = useCallback(async (code = roomRef.current?.code) => {
    if (!code) return false;
    const session = stored(code);
    if (!session?.accessToken) return false;
    try {
      const { room: next } = await api.getRoom(code, session.accessToken);
      setRoom((prev) => applyRoomState(prev, next, session.participantId));
      if (next.status === "active" && !socket.isSocketConnected()) {
        await connectToRoom(next, session.participantId, session.accessToken);
      } else if (next.status !== "active") {
        socket.disconnectSocket();
        setConnection({ connected: false, error: null });
      }
      return true;
    } catch (error) {
      if (error instanceof api.ApiRequestError && [401, 404].includes(error.status)) {
        clearInvalidToken(code);
        setRoom(null);
      }
      return false;
    }
  }, [connectToRoom]);

  useEffect(() => {
    if (room?.status === "active" || !room?.code) return;
    const timer = window.setInterval(() => { void refreshRoom(room.code); }, 15000);
    return () => window.clearInterval(timer);
  }, [room?.code, room?.status, refreshRoom]);

  useEffect(() => {
    const onState = (apiRoom) => {
      const pid = participantRef.current;
      if (pid) setRoom((prev) => applyRoomState(prev, apiRoom, pid));
    };
    const onActivity = (item) => {
      setRoom((prev) => prev ? { ...prev, activities: mergeActivity(prev.activities, { ...item, timestamp: new Date(item.timestamp) }) } : prev);
    };
    const onExpired = () => {
      const code = roomRef.current?.code;
      if (code) void refreshRoom(code);
    };
    const onConnect = () => {
      const current = roomRef.current;
      const saved = current && stored(current.code);
      if (!current || current.status !== "active" || !saved?.accessToken) return;
      void socket.joinRoomSocket(current.code, saved.participantId, saved.accessToken).then((ack) => {
        if (ack.ok && ack.room) {
          setRoom((prev) => applyRoomState(prev, ack.room, saved.participantId));
          setConnection({ connected: true, error: null });
        } else {
          setConnection({ connected: false, error: ack.error ?? "Could not reconnect" });
          void refreshRoom(current.code);
        }
      });
    };
    const onDisconnect = () => setConnection((prev) => ({ ...prev, connected: false }));
    socket.onRoomState(onState);
    socket.onActivity(onActivity);
    socket.onRoomExpired(onExpired);
    socket.onSocketConnect(onConnect);
    socket.onSocketDisconnect(onDisconnect);
    return () => {
      socket.offRoomState(onState);
      socket.offActivity(onActivity);
      socket.offRoomExpired(onExpired);
      socket.offSocketConnect(onConnect);
      socket.offSocketDisconnect(onDisconnect);
    };
  }, [refreshRoom]);

  const createRoom = useCallback(async (password, durationMinutes = 5, name = "Untitled room") => {
    setIsLoading(true);
    try {
      const result = await api.createRoom(password, durationMinutes, name);
      saveStored(result.room.code, { participantId: result.participantId,
        accessToken: result.accessToken, recoveryKey: result.recoveryKey });
      await connectToRoom(result.room, result.participantId, result.accessToken);
      return result.room.code;
    } finally { setIsLoading(false); }
  }, [connectToRoom]);

  const joinRoom = useCallback(async (code, displayName = "Guest", password) => {
    setIsLoading(true);
    try {
      const normalized = code.toUpperCase();
      const saved = stored(normalized);
      if (saved?.accessToken) {
        try {
          const existing = await api.getRoom(normalized, saved.accessToken);
          await connectToRoom(existing.room, saved.participantId, saved.accessToken);
          return { ok: true };
        } catch (error) {
          if (error instanceof api.ApiRequestError && [401, 404].includes(error.status)) clearInvalidToken(normalized);
          else throw error;
        }
      }
      const result = await api.joinRoom(normalized, displayName, password);
      await connectToRoom(result.room, result.participantId, result.accessToken);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof api.ApiRequestError ? error.code : "failed" };
    } finally { setIsLoading(false); }
  }, [connectToRoom]);

  const restoreRoom = useCallback(async (code) => {
    const normalized = code.toUpperCase();
    const saved = stored(normalized);
    if (!saved?.accessToken) return false;
    setIsLoading(true);
    try {
      const result = await api.getRoom(normalized, saved.accessToken);
      await connectToRoom(result.room, saved.participantId, saved.accessToken);
      return true;
    } catch (error) {
      if (error instanceof api.ApiRequestError && [401, 404].includes(error.status)) clearInvalidToken(normalized);
      return false;
    } finally { setIsLoading(false); }
  }, [connectToRoom]);

  const leaveRoom = useCallback(() => {
    socket.emitLeaveRoom();
    socket.disconnectSocket();
    setRoom(null);
    setParticipantId(null);
    setConnection({ connected: false, error: null });
  }, []);

  const recoverRoom = useCallback(async (code, recoveryKey) => {
    const result = await api.reopenRoom(code, recoveryKey);
    saveStored(result.room.code, { participantId: result.participantId,
      accessToken: result.accessToken, recoveryKey });
    await connectToRoom(result.room, result.participantId, result.accessToken);
    return true;
  }, [connectToRoom]);

  const deleteRoom = useCallback(async (code, recoveryKey) => {
    await api.deleteRoom(code, recoveryKey);
    saveStored(code, null);
    leaveRoom();
  }, [leaveRoom]);

  const broadcast = useCallback(async (type, content, clientId = crypto.randomUUID()) => {
    const current = roomRef.current;
    if (current?.status !== "active" || !socket.isSocketConnected()) {
      setRateLimitHint("Connection lost. Try again.");
      return false;
    }
    const trimmed = content.trim();
    if (!trimmed) return false;
    const optimistic = {
      id: clientId, type, content: trimmed,
      sender: current.participants.find((person) => person.id === participantRef.current)?.name ?? "You",
      senderId: participantRef.current, timestamp: new Date(), pending: true
    };
    setRoom((prev) => prev?.code === current.code ? { ...prev, activities: mergeActivity(prev.activities, optimistic) } : prev);
    const ack = await socket.emitActivity({ id: clientId, type, content: trimmed });
    if (ack?.ok && ack.activity) {
      setRoom((prev) => prev?.code === current.code ? { ...prev, activities: mergeActivity(prev.activities, { ...ack.activity, timestamp: new Date(ack.activity.timestamp) }) } : prev);
      return true;
    }
    setRoom((prev) => prev?.code === current.code ? { ...prev, activities: prev.activities.filter((item) => item.id !== clientId || !item.pending) } : prev);
    setRateLimitHint(ack?.error ?? "Message not sent. Try again.");
    window.setTimeout(() => setRateLimitHint(null), 3000);
    return false;
  }, []);

  const sendFile = useCallback(async (file) => {
    const current = roomRef.current;
    if (!current || current.status !== "active") return;
    const token = stored(current.code)?.accessToken;
    if (!token) return;
    const id = crypto.randomUUID();
    setUploads((prev) => [...prev, { id, name: file.name, progress: 0, status: "transferring" }]);
    try {
      await uploadRoomFile(current.code, token, file, (patch) => {
        setUploads((prev) => prev.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
      });
      await refreshRoom(current.code);
    } catch (error) {
      setUploads((prev) => prev.map((entry) => entry.id === id ? {
        ...entry, status: "failed", error: error instanceof Error ? error.message : "Upload failed"
      } : entry));
    }
  }, [refreshRoom]);

  const downloadFile = useCallback(async (fileId) => {
    const current = roomRef.current;
    if (!current) return;
    const token = stored(current.code)?.accessToken;
    if (!token) return;
    const result = await getRoomFileDownload(current.code, token, fileId);
    window.location.assign(result.url);
  }, []);

  return <RoomContext.Provider value={{
    room, participantId, connection, isLoading, rateLimitHint, uploads,
    recoveryKey: room ? stored(room.code)?.recoveryKey ?? null : null,
    recoveryKeyForCode: (code) => stored(code)?.recoveryKey ?? null,
    createRoom, joinRoom, restoreRoom, refreshRoom, leaveRoom, recoverRoom, deleteRoom,
    sendMessage: (content, clientId) => broadcast(detectLink(content), content, clientId),
    sendClipboard: (content) => broadcast("clipboard", content),
    sendCodeSnippet: (content, clientId) => broadcast("code", content, clientId),
    sendFile, downloadFile,
  }}>{children}</RoomContext.Provider>;
}

function useRoom() {
  const context = useContext(RoomContext);
  if (!context) throw new Error("useRoom must be used within RoomProvider");
  return context;
}

export { RoomProvider, useRoom };
