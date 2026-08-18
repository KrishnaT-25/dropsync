import type { ActivityItem, ApiRoomRecord, FileMeta, Participant, RoomState } from '../types'

function displayName(name: string, isYou: boolean): string {
  if (isYou) return name
  if (name === 'You') return 'Host'
  return name
}

export function mapApiRoom(
  apiRoom: ApiRoomRecord,
  participantId: string,
): RoomState {
  return {
    code: apiRoom.code,
    expiresAt: new Date(apiRoom.expiresAt),
    meetingActive: apiRoom.meetingActive,
    participants: apiRoom.participants.map((p) => {
      const isYou = p.id === participantId
      return {
        ...p,
        name: displayName(p.name, isYou),
        isYou,
        inMeeting: p.inMeeting ?? false,
        isMuted: p.isMuted ?? false,
        isCameraOff: p.isCameraOff ?? false,
        isScreenSharing: p.isScreenSharing ?? false,
      }
    }),
    activities: apiRoom.activities.map((a) => ({
      ...a,
      timestamp: new Date(a.timestamp),
    })),
  }
}

export function mergeActivity(existing: ActivityItem[], incoming: ActivityItem): ActivityItem[] {
  if (existing.some((a) => a.id === incoming.id)) {
    return existing
  }
  return [...existing, incoming]
}

function mergeFileMeta(server: FileMeta | undefined, local: FileMeta | undefined): FileMeta | undefined {
  if (!server && !local) return undefined
  if (!server) return local
  if (!local) return server

  // Prefer local runtime fields (blob URLs, live progress) over server snapshots.
  const preferLocalStatus =
    local.status === 'complete' ||
    local.status === 'failed' ||
    local.status === 'transferring' ||
    Boolean(local.objectUrl) ||
    Boolean(local.downloadUrl)

  return {
    ...server,
    ...local,
    fileName: server.fileName || local.fileName,
    fileSize: server.fileSize || local.fileSize,
    mimeType: server.mimeType || local.mimeType,
    transferId: server.transferId ?? local.transferId,
    objectUrl: local.objectUrl ?? server.objectUrl,
    downloadUrl: local.downloadUrl ?? server.downloadUrl,
    progress: preferLocalStatus ? (local.progress ?? server.progress) : (server.progress ?? local.progress),
    status: preferLocalStatus ? (local.status ?? server.status) : (server.status ?? local.status),
    transferPath: local.transferPath ?? server.transferPath,
  }
}

export function applyRoomState(
  prev: RoomState | null,
  apiRoom: ApiRoomRecord,
  participantId: string,
): RoomState {
  const next = mapApiRoom(apiRoom, participantId)

  if (!prev) return next

  const localById = new Map(
    prev.activities.filter((a) => a.type === 'file' && a.fileMeta).map((a) => [a.id, a.fileMeta!]),
  )
  const localByTransfer = new Map(
    prev.activities
      .filter((a) => a.type === 'file' && a.fileMeta?.transferId)
      .map((a) => [a.fileMeta!.transferId!, a.fileMeta!]),
  )

  // Keep optimistic self meeting flags if the server snapshot briefly lags.
  const prevSelf = prev.participants.find((p) => p.id === participantId)
  const nextSelf = next.participants.find((p) => p.id === participantId)
  if (prevSelf?.inMeeting && nextSelf && !nextSelf.inMeeting && prev.meetingActive) {
    next.participants = next.participants.map((p) =>
      p.id === participantId
        ? {
            ...p,
            inMeeting: true,
            isMuted: prevSelf.isMuted,
            isCameraOff: prevSelf.isCameraOff,
            isScreenSharing: prevSelf.isScreenSharing,
          }
        : p,
    )
    next.meetingActive = true
  }

  return {
    ...next,
    activities: next.activities.map((activity) => {
      if (activity.type !== 'file') return activity
      const local =
        localById.get(activity.id) ??
        (activity.fileMeta?.transferId
          ? localByTransfer.get(activity.fileMeta.transferId)
          : undefined)
      if (!local) return activity
      return {
        ...activity,
        fileMeta: mergeFileMeta(activity.fileMeta, local),
      }
    }),
  }
}

export function markYouParticipant(participants: Participant[], participantId: string): Participant[] {
  return participants.map((p) => ({
    ...p,
    isYou: p.id === participantId,
    name: p.id === participantId ? p.name : p.name === 'You' ? 'Host' : p.name,
  }))
}
