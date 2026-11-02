const API_BASE = import.meta.env.VITE_API_URL ?? "";
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
    throw new Error(body?.error ?? `request_failed_${response.status}`);
  }
  return response.json();
}
function createMeeting() {
  return request("/api/meetings", { method: "POST", body: "{}" });
}
function getMeeting(code) {
  return request(`/api/meetings/${code}`);
}
function joinMeeting(code, displayName) {
  return request(`/api/meetings/${code}/join`, {
    method: "POST",
    body: JSON.stringify({ displayName })
  });
}
export {
  createMeeting,
  getMeeting,
  joinMeeting
};
