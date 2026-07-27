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
}

export interface CreateRoomResponse {
  room: RoomRecord
  participantId: string
}

export interface JoinRoomResponse {
  room: RoomRecord
  participantId: string
}
