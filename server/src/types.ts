export type ActivityType = 'system' | 'message' | 'file' | 'link' | 'clipboard' | 'code' | 'meeting'

export interface ActivityItem {
  id: string
  type: ActivityType
  content: string
  sender?: string
  senderId?: string
  timestamp: string
  fileMeta?: {
    fileName: string
    fileSize: number
    mimeType: string
    transferId?: string
    progress?: number
    status?: 'pending' | 'transferring' | 'complete' | 'failed'
    transferPath?: 'direct' | 'relay' | 'storage'
    downloadUrl?: string
  }
}

export interface Participant {
  id: string
  name: string
  socketId?: string
  isMuted?: boolean
  isCameraOff?: boolean
  isScreenSharing?: boolean
  isOnline?: boolean
}

export interface RoomRecord {
  code: string
  name?: string
  createdAt: string
  expiresAt: string
  participants: Participant[]
  activities: ActivityItem[]
  /** bcrypt hash — never expose to clients */
  passwordHash?: string
  status?: 'active' | 'expired_recoverable' | 'deleting' | 'deleted'
  durationMinutes?: number
  recoveryDeadline?: string
  storageBytes?: number
  reservedBytes?: number
}

/** Room payload sent over REST/Socket (no password hash). */
export interface PublicRoomRecord {
  code: string
  name?: string
  createdAt: string
  expiresAt: string
  participants: Participant[]
  activities: ActivityItem[]
  hasPassword: boolean
  status?: 'active' | 'expired_recoverable' | 'deleting' | 'deleted'
  durationMinutes?: number
  recoveryDeadline?: string
  storageBytes?: number
  reservedBytes?: number
}

export interface CreateRoomResponse {
  room: PublicRoomRecord
  participantId: string
}

export interface JoinRoomResponse {
  room: PublicRoomRecord
  participantId: string
}

export type JoinRoomErrorCode = 'password_required' | 'incorrect_password'

export interface MeetingParticipant {
  id: string
  name: string
  isHost: boolean
  isCoHost: boolean
  admitted: boolean
  accessTokenHash: string
  socketId?: string
  isMuted: boolean
  isCameraOff: boolean
  isScreenSharing: boolean
}

export interface MeetingPermissions {
  requireAdmission: boolean
  allowScreenShare: boolean
  allowParticipantUnmute: boolean
}

export interface MeetingRecord {
  code: string
  hostParticipantId: string
  createdAt: string
  expiresAt: string
  permissions: MeetingPermissions
  participants: MeetingParticipant[]
}

export interface PublicMeetingRecord {
  code: string
  hostParticipantId: string
  createdAt: string
  expiresAt: string
  permissions: MeetingPermissions
  participants: Array<Omit<MeetingParticipant, 'socketId' | 'accessTokenHash' | 'admitted'>>
}

export type MeetingEndedReason = 'host_ended' | 'host_left'
