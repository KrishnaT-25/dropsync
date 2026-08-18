import type { ApiMeetingRecord } from '../types'

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
    throw new Error(body?.error ?? `request_failed_${response.status}`)
  }

  return response.json() as Promise<T>
}

export function createMeeting(): Promise<{ meeting: ApiMeetingRecord; participantId: string }> {
  return request('/api/meetings', { method: 'POST', body: '{}' })
}

export function getMeeting(code: string): Promise<{ meeting: ApiMeetingRecord }> {
  return request(`/api/meetings/${code}`)
}

export function joinMeeting(
  code: string,
  displayName: string,
): Promise<{ meeting: ApiMeetingRecord; participantId: string }> {
  return request(`/api/meetings/${code}/join`, {
    method: 'POST',
    body: JSON.stringify({ displayName }),
  })
}
