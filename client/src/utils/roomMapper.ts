import type { ActivityItem, ApiRoomRecord, Participant, RoomState } from '../types'

export function mapApiRoom(
  apiRoom: ApiRoomRecord,
  participantId: string,
): RoomState {
  return {
    code: apiRoom.code,
    expiresAt: new Date(apiRoom.expiresAt),
    meetingActive: apiRoom.meetingActive,
    participants: apiRoom.participants.map((p) => ({
      ...p,
      isYou: p.id === participantId,
      inMeeting: p.inMeeting ?? false,
      isMuted: p.isMuted ?? false,
      isCameraOff: p.isCameraOff ?? false,
      isScreenSharing: p.isScreenSharing ?? false,
    })),
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

export function applyRoomState(
  prev: RoomState | null,
  apiRoom: ApiRoomRecord,
  participantId: string,
): RoomState {
  const next = mapApiRoom(apiRoom, participantId)

  if (!prev) return next

  const localFiles = new Map(
    prev.activities
      .filter((a) => a.type === 'file' && a.fileMeta?.objectUrl)
      .map((a) => [a.id, a.fileMeta!.objectUrl!]),
  )

  return {
    ...next,
    activities: next.activities.map((activity) => {
      if (activity.type === 'file' && localFiles.has(activity.id)) {
        return {
          ...activity,
          fileMeta: {
            ...activity.fileMeta!,
            objectUrl: localFiles.get(activity.id),
          },
        }
      }
      return activity
    }),
  }
}

export function markYouParticipant(participants: Participant[], participantId: string): Participant[] {
  return participants.map((p) => ({
    ...p,
    isYou: p.id === participantId,
  }))
}
