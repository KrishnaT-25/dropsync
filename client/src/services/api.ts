import type { ApiRoomRecord, CreateRoomResponse, JoinRoomResponse } from '../types'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

export class ApiRequestError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status: number) {
    super(code)
    this.name = 'ApiRequestError'
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new ApiRequestError(body?.error ?? `request_failed_${response.status}`, response.status)
  }

  return response.json() as Promise<T>
}

export function createRoom(password?: string): Promise<CreateRoomResponse> {
  const body =
    password && password.trim().length > 0 ? { password: password.trim() } : {}
  return request<CreateRoomResponse>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function joinRoom(
  code: string,
  displayName?: string,
  password?: string,
): Promise<JoinRoomResponse> {
  return request<JoinRoomResponse>(`/api/rooms/${code}/join`, {
    method: 'POST',
    body: JSON.stringify({
      displayName,
      ...(password !== undefined ? { password } : {}),
    }),
  })
}

export function getRoom(code: string): Promise<{ room: ApiRoomRecord }> {
  return request<{ room: ApiRoomRecord }>(`/api/rooms/${code}`)
}

export function getIceServers(): Promise<{
  iceServers: RTCIceServer[]
  turnConfigured: boolean
}> {
  return request('/api/ice-servers')
}

export function getTransferStats(): Promise<{
  direct: number
  relay: number
  storage: number
  total: number
}> {
  return request('/api/transfer-stats')
}

export async function recordTransferStat(
  path: 'direct' | 'relay' | 'storage',
): Promise<void> {
  try {
    await request('/api/transfers/stats', {
      method: 'POST',
      body: JSON.stringify({ path }),
    })
  } catch {
    // non-critical
  }
}

export async function uploadFallbackFile(
  file: File,
): Promise<{ transferId: string; downloadUrl: string; path: 'storage' }> {
  const response = await fetch(`${API_BASE}/api/transfers/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
      'x-mime-type': file.type || 'application/octet-stream',
    },
    body: file,
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new ApiRequestError(body?.error ?? `upload_failed_${response.status}`, response.status)
  }

  return response.json() as Promise<{ transferId: string; downloadUrl: string; path: 'storage' }>
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`)
    return response.ok
  } catch {
    return false
  }
}
