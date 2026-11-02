import { Check, Clock3, Code2, Copy, Download, FileText, FolderOpen, LogOut, MessageCircle, Settings2, UploadCloud, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { Header } from "../components/layout/Header";
import { ActivityFeed } from "../components/room/ActivityFeed";
import { ExpiryTimer } from "../components/room/ExpiryTimer";
import { MessageInput } from "../components/room/MessageInput";
import { RoomCodeDisplay } from "../components/room/RoomCodeDisplay";
import { useRoom } from "../context/RoomContext";
import { normalizeRoomCode } from "../utils/roomCode";
import { formatFileSize } from "../utils/formatFileSize";
import { formatTime } from "../utils/formatTime";

const sections = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "code", label: "Code", icon: Code2 },
  { id: "participants", label: "Participants", icon: UsersRound },
  { id: "settings", label: "Settings", icon: Settings2 },
];

export function RoomPage() {
  const { code: rawCode } = useParams();
  const code = normalizeRoomCode(rawCode ?? "");
  const navigate = useNavigate();
  const {
    room, participantId, recoveryKey, recoveryKeyForCode, uploads, rateLimitHint, isLoading,
    leaveRoom, restoreRoom, refreshRoom, recoverRoom, deleteRoom,
    sendMessage, sendClipboard, sendCodeSnippet, sendFile, downloadFile
  } = useRoom();
  const [checked, setChecked] = useState(false);
  const [section, setSection] = useState("chat");
  const [keyInput, setKeyInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [confirmCode, setConfirmCode] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef(null);
  const availableKey = keyInput.trim() || recoveryKey || recoveryKeyForCode(code);
  useEffect(() => {
    if (!code) { navigate("/", { replace: true }); return; }
    if (room?.code === code) { setChecked(true); return; }
    let cancelled = false;
    void restoreRoom(code).then(() => { if (!cancelled) setChecked(true); });
    return () => { cancelled = true; };
  }, [code, room?.code, restoreRoom, navigate]);

  const recover = async () => {
    setBusy(true); setError("");
    try { await recoverRoom(code, availableKey); setKeyInput(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not reopen room"); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (confirmCode !== code) return;
    setBusy(true); setError("");
    try { await deleteRoom(code, availableKey); navigate("/"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete room"); }
    finally { setBusy(false); }
  };
  const handleDownload = async (fileId) => {
    setError("");
    try { await downloadFile(fileId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not download file"); }
  };
  const copyInvite = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/?join=${code}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  const selectFiles = (files) => { if (files) Array.from(files).forEach((file) => void sendFile(file)); };
  const onDrop = (event) => { event.preventDefault(); setDragActive(false); selectFiles(event.dataTransfer.files); };

  if (!checked || isLoading) return <AppShell centered><div className="ds-loading">Loading room...</div></AppShell>;
  if (!room || room.code !== code) return <AppShell><Header /><main className="ds-home-main ds-home-form"><div className="ds-form-view">
    <div className="ds-form-heading"><Clock3 className="ds-heading-icon" size={40} /><h1>Recover Room</h1><p>The creator can reopen this room before its recovery deadline.</p></div>
    <div className="ds-form-card"><label htmlFor="recovery-key">Recovery Key</label><input id="recovery-key" className="ds-field" type="password" value={keyInput} onChange={(event) => setKeyInput(event.target.value)} placeholder="Enter your recovery key" />
      {error && <p className="ds-form-error">{error}</p>}<button className="ds-primary-button" disabled={busy || !availableKey} onClick={recover}>Reopen Room</button>
      <button className="ds-text-link" onClick={() => navigate(`/?view=join&joinCode=${code}`)}>Join active room instead</button>
      <div className="ds-danger-zone"><button className="ds-text-link ds-danger" onClick={() => setShowDelete(!showDelete)}>Delete room with recovery key</button>{showDelete && <><p>Type <strong>{code}</strong> to confirm. Access ends immediately.</p><input className="ds-field" value={confirmCode} onChange={(event) => setConfirmCode(event.target.value)} placeholder={code} /><button className="ds-danger-button" disabled={busy || confirmCode !== code || !availableKey} onClick={remove}>Confirm deletion</button></>}</div>
    </div></div></main></AppShell>;

  const active = room.status === "active";
  const files = room.activities.filter((item) => item.type === "file" && item.fileMeta?.status !== "failed");
  const codeItems = room.activities.filter((item) => item.type === "code");
  const roomTitle = room.name || `Room ${room.code}`;
  return <AppShell>
    <Header roomName={roomTitle} showOnline={active} onlineCount={room.participants.filter((person) => person.isOnline).length} rightSlot={!active && <span className="ds-status">Read-only recovery</span>} />
    <main className="ds-dashboard">
      <aside className="ds-sidebar">
        <div className="ds-mobile-room-title"><strong>{roomTitle}</strong><span>{room.code}</span></div>
        <nav className="ds-sidebar-nav" aria-label="Room sections">{sections.map(({ id, label, icon: Icon }) => <button key={id} className={`ds-sidebar-link ${section === id ? "selected" : ""}`} onClick={() => setSection(id)}><Icon size={17} /><span>{label}</span>{id === "files" && files.length > 0 && <small>{files.length}</small>}</button>)}</nav>
        <div className="ds-sidebar-bottom"><div className="ds-expiry-card"><span>Room {active ? "expires in" : "recoverable until"}</span><ExpiryTimer expiresAt={room.expiresAt} recoveryDeadline={room.recoveryDeadline} status={room.status} onExpire={() => void refreshRoom(code)} /></div><button className="ds-leave" onClick={() => { leaveRoom(); navigate("/"); }}><LogOut size={16} />Leave room</button></div>
      </aside>
      <section className="ds-workspace">
        {!active && <div className="ds-recovery-banner"><Clock3 size={18} /><span>This room has expired. You can read and download until {room.recoveryDeadline?.toLocaleString()}. The creator can reopen it.</span></div>}
        {section === "chat" && <><div className="ds-panel-header"><div><h1>Chat</h1><p>Messages, links and shared activity in one place.</p></div><button className="ds-outline-button" onClick={copyInvite}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Invite"}</button></div><div className="ds-chat-content"><ActivityFeed activities={room.activities} selfParticipantId={participantId} onDownload={handleDownload} title="Conversation" /></div>{active && <MessageInput onSend={sendMessage} onSendClipboard={sendClipboard} onSendCode={sendCodeSnippet} onSendFile={sendFile} rateLimitHint={rateLimitHint} />}</>}
        {section === "files" && <><div className="ds-panel-header"><div><h1>Files</h1><p>{formatFileSize(room.storageBytes + room.reservedBytes)} of 2 GiB used or reserved</p></div>{active && <button className="ds-primary-button ds-upload-button" onClick={() => fileInputRef.current?.click()}><UploadCloud size={17} />Upload Files</button>}</div><input ref={fileInputRef} type="file" multiple hidden onChange={(event) => { selectFiles(event.target.files); event.target.value = ""; }} />{active && <div className={`ds-dropzone ${dragActive ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={onDrop}><UploadCloud size={34} /><strong>Drag & drop files here</strong><span>or <button onClick={() => fileInputRef.current?.click()}>click to browse</button></span><small>Up to 500 MiB per file</small></div>}<div className="ds-file-table"><div className="ds-file-head"><span>Name</span><span>Size</span><span>Uploaded</span><span /></div>{files.length ? files.map((item) => <div className="ds-file-row" key={item.id}><div className="ds-file-name"><FileText size={18} /><span>{item.fileMeta.fileName}</span></div><span>{formatFileSize(item.fileMeta.fileSize)}</span><span>{formatTime(item.timestamp)}</span><button aria-label={`Download ${item.fileMeta.fileName}`} onClick={() => void handleDownload(item.fileMeta.transferId)}><Download size={18} /></button></div>) : <div className="ds-table-empty">No files shared yet.</div>}</div></>}
        {section === "code" && <><div className="ds-panel-header"><div><h1>Code Snippets</h1><p>Code shared by this room’s members.</p></div></div><div className="ds-code-content"><ActivityFeed activities={codeItems} selfParticipantId={participantId} title="Shared code" /></div>{active && <MessageInput onSend={sendMessage} onSendClipboard={sendClipboard} onSendCode={sendCodeSnippet} onSendFile={sendFile} rateLimitHint={rateLimitHint} />}</>}
        {section === "participants" && <><div className="ds-panel-header"><div><h1>Participants</h1><p>{room.participants.length} people have joined this room.</p></div><button className="ds-outline-button" onClick={copyInvite}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Copy invite"}</button></div><div className="ds-people-grid">{room.participants.map((person) => <div className="ds-person" key={person.id}><span className="ds-person-avatar">{(person.name || "?").slice(0, 1).toUpperCase()}</span><span><strong>{person.isYou ? "You" : person.name}</strong><small>{person.isOnline ? "Online" : "Offline"}</small></span><span className={`ds-presence ${person.isOnline ? "online" : ""}`} /></div>)}</div></>}
        {section === "settings" && <><div className="ds-panel-header"><div><h1>Room Settings</h1><p>Sharing, storage and recovery controls.</p></div></div><div className="ds-settings-grid"><div className="ds-settings-card"><h2>Invite people</h2><RoomCodeDisplay code={room.code} joinUrl={`${window.location.origin}/?join=${room.code}`} /></div><div className="ds-settings-card"><h2>Storage & recovery</h2><p>{formatFileSize(room.storageBytes + room.reservedBytes)} of 2 GiB used or reserved</p><p>Original duration: {room.durationMinutes} minutes</p>{recoveryKey && <><label>Creator recovery key</label><div className="ds-secret">{recoveryKey}</div><button className="ds-text-link" onClick={() => void navigator.clipboard.writeText(recoveryKey)}>Copy recovery key</button><small>Save this key to reopen or delete the room.</small></>}{!active && recoveryKey && <button className="ds-primary-button" disabled={busy} onClick={recover}>Reopen for {room.durationMinutes} minutes</button>}</div></div>{recoveryKey && <div className="ds-danger-zone"><button className="ds-text-link ds-danger" onClick={() => setShowDelete(!showDelete)}>Delete room now</button>{showDelete && <><p>Type <strong>{code}</strong> to confirm. Access stops now; signed links may work for up to five minutes.</p><input className="ds-field" value={confirmCode} onChange={(event) => setConfirmCode(event.target.value)} placeholder={code} /><button className="ds-danger-button" disabled={busy || confirmCode !== code} onClick={remove}>Confirm deletion</button></>}</div>}</>}
        {uploads.map((upload) => <div key={upload.id} className={`ds-upload-progress ${upload.status === "failed" ? "failed" : ""}`}><span>{upload.name}: {upload.status === "failed" ? `${upload.error}. Select the same file to resume.` : `${Math.round(upload.progress * 100)}% ${upload.status}`}</span>{upload.status !== "failed" && <div><span style={{ width: `${Math.round(upload.progress * 100)}%` }} /></div>}</div>)}
        {error && <p className="ds-form-error">{error}</p>}
      </section>
    </main>
  </AppShell>;
}
