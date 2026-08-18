const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateMeetingCode(): string {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return code
}

export function formatMeetingCode(code: string): string {
  const clean = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  if (clean.length <= 3) return clean
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}`
}

export function normalizeMeetingCode(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6)
}

export function isValidMeetingCode(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(normalizeMeetingCode(code))
}

/** Extract a meeting code from a pasted DropSync meet URL or raw code. */
export function parseMeetingCodeInput(input: string): string {
  const trimmed = input.trim()
  try {
    const url = new URL(trimmed)
    const meetMatch = url.pathname.match(/\/meet\/([a-zA-Z0-9-]+)/i)
    if (meetMatch?.[1]) return normalizeMeetingCode(meetMatch[1])
    const q = url.searchParams.get('meet')
    if (q) return normalizeMeetingCode(q)
  } catch {
    // not a URL
  }
  return normalizeMeetingCode(trimmed)
}
