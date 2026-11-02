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
  return /^[A-Z0-9]{6}$/.test(normalizeMeetingCode(code));
}
function parseMeetingCodeInput(input) {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const meetMatch = url.pathname.match(/\/meet\/([a-zA-Z0-9-]+)/i);
    if (meetMatch?.[1]) return normalizeMeetingCode(meetMatch[1]);
    const q = url.searchParams.get("meet");
    if (q) return normalizeMeetingCode(q);
  } catch {
  }
  return normalizeMeetingCode(trimmed);
}
export {
  formatMeetingCode,
  generateMeetingCode,
  isValidMeetingCode,
  normalizeMeetingCode,
  parseMeetingCodeInput
};
