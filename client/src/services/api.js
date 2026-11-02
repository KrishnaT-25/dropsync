const API_BASE = import.meta.env.VITE_API_URL ?? "";
class ApiRequestError extends Error {
  code;
  status;
  constructor(code, status) {
    super(code);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
  }
}
async function request(path, init) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers ?? {}
    },
    ...init
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiRequestError(body?.error ?? `request_failed_${response.status}`, response.status);
  }
  return response.json();
}
function createRoom(password, durationMinutes = 5, name = "Untitled room") {
  const body = password && password.trim().length > 0 ? { password: password.trim() } : {};
  body.durationMinutes = durationMinutes;
  body.name = name;
  return request("/api/rooms", {
    method: "POST",
    body: JSON.stringify(body)
  });
}
function joinRoom(code, displayName, password) {
  return request(`/api/rooms/${code}/join`, {
    method: "POST",
    body: JSON.stringify({
      displayName,
      ...password !== void 0 ? { password } : {}
    })
  });
}
function getRoom(code, accessToken) {
  return request(`/api/rooms/${code}`, { headers: { Authorization: `Bearer ${accessToken}` } });
}
function previewRoom(code) {
  return request(`/api/rooms/${code}/preview`);
}
function reopenRoom(code, recoveryKey) {
  return request(`/api/rooms/${code}/reopen`, { method: "POST", body: JSON.stringify({ recoveryKey }) });
}
function deleteRoom(code, recoveryKey) {
  return request(`/api/rooms/${code}`, { method: "DELETE", body: JSON.stringify({ recoveryKey }) });
}
function getIceServers() {
  return request("/api/ice-servers");
}
function getTransferStats() {
  return request("/api/transfer-stats");
}
async function recordTransferStat(path) {
  try {
    await request("/api/transfers/stats", {
      method: "POST",
      body: JSON.stringify({ path })
    });
  } catch {
  }
}
async function uploadFallbackFile(file) {
  const response = await fetch(`${API_BASE}/api/transfers/upload`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "x-file-name": encodeURIComponent(file.name),
      "x-mime-type": file.type || "application/octet-stream"
    },
    body: file
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiRequestError(body?.error ?? `upload_failed_${response.status}`, response.status);
  }
  return response.json();
}
async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
export {
  ApiRequestError,
  checkHealth,
  createRoom,
  getIceServers,
  getRoom,
  previewRoom,
  reopenRoom,
  deleteRoom,
  getTransferStats,
  joinRoom,
  recordTransferStat,
  uploadFallbackFile
};
