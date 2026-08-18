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

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`)
    return response.ok
  } catch {
    return false
  }
}
