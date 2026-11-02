import { io } from "socket.io-client";
const SOCKET_URL = import.meta.env.VITE_API_URL ?? window.location.origin;
let socket = null;
function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ["websocket", "polling"]
    });
  }
  return socket;
}
function connectSocket() {
  const instance = getSocket();
  if (!instance.connected) {
    instance.connect();
  }
  return instance;
}
function disconnectSocket() {
  if (socket?.connected) {
    socket.disconnect();
  }
}
function joinRoomSocket(code, participantId, accessToken) {
  const instance = connectSocket();
  return new Promise((resolve) => {
    instance.timeout(10000).emit("join-room", { code, participantId, accessToken }, (error, ack) => {
      resolve(error ? { ok: false, error: "Room connection timed out" } : ack ?? { ok: false, error: "No response from server" });
    });
  });
}
function emitActivity(payload) {
  return new Promise((resolve) => {
    const instance = getSocket();
    if (!instance.connected) {
      resolve({ ok: false, error: "Connection lost. Try again." });
      return;
    }
    instance.timeout(10000).emit("activity", payload, (error, ack) => {
      resolve(error ? { ok: false, error: "Could not confirm the message. Try again." } : ack ?? { ok: false, error: "No response from server" });
    });
  });
}
function emitSystemActivity(content) {
  getSocket().emit("system-activity", content);
}
function emitLeaveRoom() {
  getSocket().emit("leave-room");
}
function onRoomState(handler) {
  getSocket().on("room-state", handler);
}
function onActivity(handler) {
  getSocket().on("activity", handler);
}
function onRoomExpired(handler) {
  getSocket().on("room-expired", handler);
}
function offRoomState(handler) {
  getSocket().off("room-state", handler);
}
function offActivity(handler) {
  getSocket().off("activity", handler);
}
function offRoomExpired(handler) {
  getSocket().off("room-expired", handler);
}
function onSocketConnect(handler) {
  getSocket().on("connect", handler);
}
function onSocketDisconnect(handler) {
  getSocket().on("disconnect", handler);
}
function offSocketConnect(handler) {
  getSocket().off("connect", handler);
}
function offSocketDisconnect(handler) {
  getSocket().off("disconnect", handler);
}
function onFileTransferComplete(handler) {
  getSocket().on("file-transfer-complete", handler);
}
function offFileTransferComplete(handler) {
  getSocket().off("file-transfer-complete", handler);
}
function isSocketConnected() {
  return getSocket().connected;
}
export {
  connectSocket,
  disconnectSocket,
  emitActivity,
  emitLeaveRoom,
  emitSystemActivity,
  getSocket,
  isSocketConnected,
  joinRoomSocket,
  offActivity,
  offFileTransferComplete,
  offRoomExpired,
  offRoomState,
  offSocketConnect,
  offSocketDisconnect,
  onActivity,
  onFileTransferComplete,
  onRoomExpired,
  onRoomState,
  onSocketConnect,
  onSocketDisconnect
};
