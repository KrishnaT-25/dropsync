import { getSocket, connectSocket } from "./socket";
function joinMeetingSocket(code, participantId, displayName) {
  const instance = connectSocket();
  return new Promise((resolve) => {
    instance.emit(
      "join-meeting",
      { code, participantId, displayName },
      (ack) => {
        resolve(ack ?? { ok: false, error: "No response from server" });
      }
    );
  });
}
function emitMeetingMediaState(payload) {
  getSocket().emit("meeting-media-state", payload);
}
function emitMeetingActivity(content) {
  return new Promise((resolve) => {
    getSocket().emit("meeting-activity", { content }, (ack) => {
      resolve(ack ?? { ok: true });
    });
  });
}
function emitHostMute(targetParticipantId) {
  getSocket().emit("host-mute", { targetParticipantId });
}
function emitHostRemove(targetParticipantId) {
  getSocket().emit("host-remove", { targetParticipantId });
}
function emitHostEnd() {
  getSocket().emit("host-end");
}
function emitLeaveMeeting() {
  getSocket().emit("leave-meeting");
}
function onMeetingState(handler) {
  getSocket().on("meeting-state", handler);
}
function offMeetingState(handler) {
  getSocket().off("meeting-state", handler);
}
function onPeerJoined(handler) {
  getSocket().on("peer-joined", handler);
}
function offPeerJoined(handler) {
  getSocket().off("peer-joined", handler);
}
function onPeerLeft(handler) {
  getSocket().on("peer-left", handler);
}
function offPeerLeft(handler) {
  getSocket().off("peer-left", handler);
}
function onMeetingActivity(handler) {
  getSocket().on("meeting-activity", handler);
}
function offMeetingActivity(handler) {
  getSocket().off("meeting-activity", handler);
}
function onForceMuted(handler) {
  getSocket().on("force-muted", handler);
}
function offForceMuted(handler) {
  getSocket().off("force-muted", handler);
}
function onRemovedByHost(handler) {
  getSocket().on("removed-by-host", handler);
}
function offRemovedByHost(handler) {
  getSocket().off("removed-by-host", handler);
}
function onMeetingEnded(handler) {
  getSocket().on("meeting-ended", handler);
}
function offMeetingEnded(handler) {
  getSocket().off("meeting-ended", handler);
}
function getMeetingSocket() {
  return getSocket();
}
export {
  emitHostEnd,
  emitHostMute,
  emitHostRemove,
  emitLeaveMeeting,
  emitMeetingActivity,
  emitMeetingMediaState,
  getMeetingSocket,
  joinMeetingSocket,
  offForceMuted,
  offMeetingActivity,
  offMeetingEnded,
  offMeetingState,
  offPeerJoined,
  offPeerLeft,
  offRemovedByHost,
  onForceMuted,
  onMeetingActivity,
  onMeetingEnded,
  onMeetingState,
  onPeerJoined,
  onPeerLeft,
  onRemovedByHost
};
