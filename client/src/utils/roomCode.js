const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateRoomCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}
function formatRoomCode(code) {
  const clean = code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (clean.length <= 3) return clean;
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}`;
}
function normalizeRoomCode(input) {
  return input.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6);
}
function isValidRoomCode(code) {
  return /^[A-Z0-9]{6}$/.test(normalizeRoomCode(code));
}
function getRoomCodeChars(code) {
  return formatRoomCode(normalizeRoomCode(code)).split("");
}
export {
  formatRoomCode,
  generateRoomCode,
  getRoomCodeChars,
  isValidRoomCode,
  normalizeRoomCode
};
