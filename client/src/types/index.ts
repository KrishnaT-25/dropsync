export type ActivityType = 'system' | 'message' | 'file' | 'link' | 'clipboard' | 'code' | 'meeting'

export interface FileMeta {
  fileName: string
  fileSize: number
  mimeType: string
  objectUrl?: string
  transferId?: string
  progress?: number
  status?: 'pending' | 'transferring' | 'complete' | 'failed'
  transferPath?: 'direct' | 'relay' | 'storage'
  downloadUrl?: string
}

export interface ActivityItem {
  id: string
  type: ActivityType
  content: string
  sender?: string
  senderId?: string
  timestamp: Date
  fileMeta?: FileMeta
}

export interface Participant {
  id: string
  name: string
  isYou?: boolean
  inMeeting?: boolean
  isMuted?: boolean
  isCameraOff?: boolean
  isScreenSharing?: boolean
}

export interface RoomState {
  code: string
  expiresAt: Date
  participants: Participant[]
  activities: ActivityItem[]
  meetingActive: boolean
}

export interface MeetingTile {
  id: string
  name: string
  isYou?: boolean
  isMuted?: boolean
  isCameraOff?: boolean
  isScreenSharing?: boolean
  stream?: MediaStream | null
}

export interface ApiRoomRecord {
  code: string
  createdAt: string
  expiresAt: string
  participants: Array<Omit<Participant, 'isYou'>>
  activities: Array<Omit<ActivityItem, 'timestamp'> & { timestamp: string }>
  meetingActive: boolean
  hasPassword?: boolean
}

export interface CreateRoomResponse {
  room: ApiRoomRecord
  participantId: string
}

export interface JoinRoomResponse {
  room: ApiRoomRecord
  participantId: string
}

export type JoinRoomErrorCode = 'password_required' | 'incorrect_password'

export type JoinRoomResult =
  | { ok: true }
  | { ok: false; error: JoinRoomErrorCode | 'failed' }

export interface ConnectionStatus {
  connected: boolean
  error: string | null
}
