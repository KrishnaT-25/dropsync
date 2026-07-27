const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateRoomCode(): string {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return code
}

export function formatRoomCode(code: string): string {
  const clean = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  if (clean.length <= 3) return clean
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}`
}

export function normalizeRoomCode(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6)
}

export function isValidRoomCode(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(normalizeRoomCode(code))
}

export function getRoomCodeChars(code: string): string[] {
  return formatRoomCode(normalizeRoomCode(code)).split('')
}
