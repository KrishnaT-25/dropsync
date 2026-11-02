const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateMeetingCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}
function formatMeetingCode(code) {
  const clean = code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (clean.length <= 3) return clean;
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}`;
}
function normalizeMeetingCode(input) {
  return input.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6);
}
function isValidMeetingCode(code) {
  return /^[A-Z0-9]{6}$/.test(String(code).trim().toUpperCase().replace(/^([A-Z0-9]{3})-([A-Z0-9]{3})$/, "$1$2"));
}
function parseMeetingLink(input) {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    const meetMatch = url.pathname.match(/^\/meet\/([a-zA-Z0-9]{3}-?[a-zA-Z0-9]{3})\/?$/i);
    if (meetMatch?.[1] && isValidMeetingCode(meetMatch[1])) return normalizeMeetingCode(meetMatch[1]);
    if (url.pathname === "/" && isValidMeetingCode(url.searchParams.get("meet") ?? "")) {
      return normalizeMeetingCode(url.searchParams.get("meet"));
    }
  } catch {
  }
  return "";
}
function parseMeetingCodeInput(input) {
  const trimmed = input.trim();
  return isValidMeetingCode(trimmed) ? normalizeMeetingCode(trimmed) : parseMeetingLink(trimmed);
}
function buildMeetingLink(code, origin) {
  if (!isValidMeetingCode(code)) return "";
  return new URL(`/meet/${normalizeMeetingCode(code)}`, origin).toString();
}
export {
  buildMeetingLink,
  formatMeetingCode,
  generateMeetingCode,
  isValidMeetingCode,
  normalizeMeetingCode,
  parseMeetingLink,
  parseMeetingCodeInput
};
