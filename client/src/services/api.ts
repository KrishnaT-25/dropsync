import type { ApiRoomRecord, CreateRoomResponse, JoinRoomResponse } from '../types'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

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
    throw new Error(body?.error ?? `Request failed (${response.status})`)
  }

  return response.json() as Promise<T>
}

export function createRoom(): Promise<CreateRoomResponse> {
  return request<CreateRoomResponse>('/api/rooms', { method: 'POST' })
}

export function joinRoom(code: string, displayName?: string): Promise<JoinRoomResponse> {
  return request<JoinRoomResponse>(`/api/rooms/${code}/join`, {
    method: 'POST',
    body: JSON.stringify({ displayName }),
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
