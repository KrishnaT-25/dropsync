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
  inMeeting?: boolean
  isMuted?: boolean
  isCameraOff?: boolean
  isScreenSharing?: boolean
}

export interface RoomRecord {
  code: string
  createdAt: string
  expiresAt: string
  participants: Participant[]
  activities: ActivityItem[]
  meetingActive: boolean
  /** bcrypt hash — never expose to clients */
  passwordHash?: string
}

/** Room payload sent over REST/Socket (no password hash). */
export interface PublicRoomRecord {
  code: string
  createdAt: string
  expiresAt: string
  participants: Participant[]
  activities: ActivityItem[]
  meetingActive: boolean
  hasPassword: boolean
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
