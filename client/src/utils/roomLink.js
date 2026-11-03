import { isValidRoomCode, normalizeRoomCode } from "./roomCode.js";

export function parseRoomLink(input) {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const code = url.searchParams.get("join") || url.pathname.match(/^\/room\/([a-zA-Z0-9]{6})\/?$/)?.[1];
    return code && /^[a-zA-Z0-9]{6}$/.test(code) && isValidRoomCode(code) ? normalizeRoomCode(code) : null;
  } catch { return null; }
}
