function displayName(name, isYou) {
  if (isYou) return name;
  if (name === "You") return "Host";
  return name;
}
function mapApiRoom(apiRoom, participantId) {
  return {
    code: apiRoom.code,
    name: apiRoom.name ?? "Untitled room",
    expiresAt: new Date(apiRoom.expiresAt),
    recoveryDeadline: apiRoom.recoveryDeadline ? new Date(apiRoom.recoveryDeadline) : null,
    durationMinutes: apiRoom.durationMinutes ?? 5,
    status: apiRoom.status ?? "active",
    storageBytes: apiRoom.storageBytes ?? 0,
    reservedBytes: apiRoom.reservedBytes ?? 0,
    participants: apiRoom.participants.map((p) => {
      const isYou = p.id === participantId;
      return {
        ...p,
        name: displayName(p.name, isYou),
        isYou
      };
    }),
    activities: apiRoom.activities.map((a) => ({
      ...a,
      timestamp: new Date(a.timestamp)
    }))
  };
}
function mergeActivity(existing, incoming) {
  const index = existing.findIndex((a) => a.id === incoming.id);
  if (index === -1) return [...existing, incoming];
  if (!existing[index].pending) return existing;
  const merged = [...existing];
  merged[index] = incoming;
  return merged;
}
function mergeFileMeta(server, local) {
  if (!server && !local) return void 0;
  if (!server) return local;
  if (!local) return server;
  const preferLocalStatus = local.status === "complete" || local.status === "failed" || local.status === "transferring" || Boolean(local.objectUrl) || Boolean(local.downloadUrl);
  return {
    ...server,
    ...local,
    fileName: server.fileName || local.fileName,
    fileSize: server.fileSize || local.fileSize,
    mimeType: server.mimeType || local.mimeType,
    transferId: server.transferId ?? local.transferId,
    objectUrl: local.objectUrl ?? server.objectUrl,
    downloadUrl: local.downloadUrl ?? server.downloadUrl,
    progress: preferLocalStatus ? local.progress ?? server.progress : server.progress ?? local.progress,
    status: preferLocalStatus ? local.status ?? server.status : server.status ?? local.status,
    transferPath: local.transferPath ?? server.transferPath
  };
}
function applyRoomState(prev, apiRoom, participantId) {
  const next = mapApiRoom(apiRoom, participantId);
  if (!prev) return next;
  const localById = new Map(
    prev.activities.filter((a) => a.type === "file" && a.fileMeta).map((a) => [a.id, a.fileMeta])
  );
  const localByTransfer = new Map(
    prev.activities.filter((a) => a.type === "file" && a.fileMeta?.transferId).map((a) => [a.fileMeta.transferId, a.fileMeta])
  );
  return {
    ...next,
    activities: next.activities.map((activity) => {
      if (activity.type !== "file") return activity;
      const local = localById.get(activity.id) ?? (activity.fileMeta?.transferId ? localByTransfer.get(activity.fileMeta.transferId) : void 0);
      if (!local) return activity;
      return {
        ...activity,
        fileMeta: mergeFileMeta(activity.fileMeta, local)
      };
    }).concat(prev.activities.filter((activity) => activity.pending && !next.activities.some((serverActivity) => serverActivity.id === activity.id)))
  };
}
function markYouParticipant(participants, participantId) {
  return participants.map((p) => ({
    ...p,
    isYou: p.id === participantId,
    name: p.id === participantId ? p.name : p.name === "You" ? "Host" : p.name
  }));
}
export {
  applyRoomState,
  mapApiRoom,
  markYouParticipant,
  mergeActivity
};
