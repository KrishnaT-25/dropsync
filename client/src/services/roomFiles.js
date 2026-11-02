const API_BASE = import.meta.env.VITE_API_URL ?? "";
const PENDING_KEY = "dropsync-pending-uploads";

async function api(path, token, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error ?? `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function pending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}"); }
  catch { return {}; }
}

function savePending(key, value) {
  const all = pending();
  if (value) all[key] = value;
  else delete all[key];
  localStorage.setItem(PENDING_KEY, JSON.stringify(all));
}

async function fingerprint(file) {
  const edge = 1024 * 1024;
  const sample = new Blob([file.slice(0, edge), file.slice(Math.max(0, file.size - edge))]);
  const digest = await crypto.subtle.digest("SHA-256", await sample.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function uploadRoomFile(code, token, file, onProgress) {
  if (file.size < 1 || file.size > 500 * 1024 * 1024) throw new Error("Choose a file up to 500 MiB");
  const key = `${code}:${file.name}:${file.size}:${file.lastModified}`;
  const hash = await fingerprint(file);
  const base = `/api/rooms/${code}/files`;
  let record = pending()[key];
  let status;
  if (record && record.fingerprint !== hash) {
    try { await api(`${base}/${record.fileId}/abort`, token, { method: "POST" }); }
    catch { /* The server will reclaim abandoned uploads. */ }
    savePending(key, null);
    record = null;
  }
  if (record && record.fingerprint === hash) {
    try { status = await api(`${base}/${record.fileId}/upload-status`, token); }
    catch (error) {
      if (![404, 409].includes(error.status)) throw error;
      savePending(key, null);
      record = null;
    }
  }
  if (!record) {
    record = await api(base, token, { method: "POST", body: JSON.stringify({
      fileName: file.name, mimeType: file.type || "application/octet-stream", size: file.size, fingerprint: hash
    }) });
    record.fingerprint = hash;
    savePending(key, record);
    status = { parts: [], partSize: record.partSize };
  }
  if (status.readyToFinalize) {
    await api(`${base}/${record.fileId}/complete`, token, { method: "POST" });
    savePending(key, null);
    onProgress?.({ progress: 1, status: "complete" });
    return record.fileId;
  }
  const partSize = status.partSize;
  const partCount = Math.ceil(file.size / partSize);
  const uploaded = new Set(status.parts.map((part) => part.partNumber));
  let doneBytes = Array.from(uploaded).reduce((total, partNumber) => total + Math.min(partSize, file.size - (partNumber - 1) * partSize), 0);
  onProgress?.({ progress: doneBytes / file.size, status: "transferring" });
  const todo = Array.from({ length: partCount }, (_, i) => i + 1).filter((number) => !uploaded.has(number));
  let cursor = 0;
  const worker = async () => {
    while (cursor < todo.length) {
      const partNumber = todo[cursor++];
      const start = (partNumber - 1) * partSize;
      const blob = file.slice(start, Math.min(start + partSize, file.size));
      let succeeded = false;
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const { url } = await api(`${base}/${record.fileId}/parts/${partNumber}/url`, token, { method: "POST" });
          const response = await fetch(url, { method: "PUT", body: blob });
          if (!response.ok || !response.headers.get("ETag")) throw new Error(`Part ${partNumber} failed (${response.status})`);
          succeeded = true;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
      }
      if (!succeeded) throw lastError;
      doneBytes += blob.size;
      onProgress?.({ progress: doneBytes / file.size, status: "transferring" });
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, todo.length) }, () => worker()));
  await api(`${base}/${record.fileId}/complete`, token, { method: "POST" });
  savePending(key, null);
  onProgress?.({ progress: 1, status: "complete" });
  return record.fileId;
}

async function getRoomFileDownload(code, token, fileId) {
  return api(`/api/rooms/${code}/files/${fileId}/download-url`, token);
}

export { uploadRoomFile, getRoomFileDownload };
