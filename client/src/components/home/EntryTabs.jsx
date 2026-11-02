import { Check, Clock3, LockKeyhole, PlusCircle, UsersRound, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useRoom } from "../../context/RoomContext";
import * as api from "../../services/api";
import * as meetingApi from "../../services/meetingApi";
import { formatMeetingCode, isValidMeetingCode, parseMeetingCodeInput } from "../../utils/meetingCode";
import { isValidRoomCode, normalizeRoomCode } from "../../utils/roomCode";

const MEETING_STORAGE_KEY = "dropsync-meeting-session";
const choices = [{ label: "1 Hour", minutes: 60 }, { label: "6 Hours", minutes: 360 }, { label: "24 Hours", minutes: 1440 }];

function RecentRooms() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  useEffect(() => {
    let cancelled = false;
    let grants = {};
    try { grants = JSON.parse(localStorage.getItem("dropsync-room-grants") || "{}"); } catch { /* ignore */ }
    void Promise.all(Object.entries(grants).map(async ([code, grant]) => {
      if (!grant?.accessToken) return null;
      try { return (await api.getRoom(code, grant.accessToken)).room; } catch { return null; }
    })).then((results) => { if (!cancelled) setRooms(results.filter(Boolean)); });
    return () => { cancelled = true; };
  }, []);
  return <div className="ds-recent-view">
    <div className="ds-form-heading"><Clock3 className="ds-heading-icon" size={39} /><h1>Recent <em>Rooms</em></h1><p>Return to rooms you joined in this browser.</p></div>
    <div className="ds-recent-list">{rooms.length ? rooms.map((room) => <button key={room.code} className="ds-recent-item" onClick={() => navigate(`/room/${room.code}`)}>
      <span className="ds-recent-avatar"><UsersRound size={22} /></span><span className="ds-recent-info"><strong>{room.name || room.code}</strong><small>{room.code} · {room.participants.length} members · {room.activities.length} updates</small></span>
      <span className={`ds-status ${room.status === "active" ? "is-active" : ""}`}>{room.status === "active" ? "Live" : "Recoverable"}</span>
    </button>) : <div className="ds-empty"><UsersRound size={34} /><h2>No recent rooms yet</h2><p>Rooms you create or join will appear here on this browser.</p><button className="ds-primary-button" onClick={() => navigate("/?view=create")}>Create a Room</button></div>}</div>
  </div>;
}

export function EntryTabs({ view }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { createRoom, joinRoom, isLoading } = useRoom();
  const [roomName, setRoomName] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [customDuration, setCustomDuration] = useState(false);
  const [passwordOn, setPasswordOn] = useState(false);
  const [createPassword, setCreatePassword] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [needPassword, setNeedPassword] = useState(false);
  const [meetInput, setMeetInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const preset = searchParams.get("joinCode") ?? searchParams.get("join");
    if (preset) setJoinCode(normalizeRoomCode(preset));
    if (searchParams.get("needPassword") === "1") setNeedPassword(true);
    const meet = searchParams.get("meetCode");
    if (meet && isValidMeetingCode(meet)) setMeetInput(formatMeetingCode(meet));
  }, [searchParams]);
  const create = async (event) => {
    event.preventDefault(); setError("");
    const duration = Number(durationMinutes);
    if (!Number.isInteger(duration) || duration < 5 || duration > 1440) return setError("Choose 5 to 1440 minutes.");
    if (passwordOn && createPassword.trim().length < 4) return setError("Room password must be at least 4 characters.");
    try {
      const code = await createRoom(passwordOn ? createPassword.trim() : undefined, duration, roomName.trim() || "Untitled room");
      navigate(`/room/${code}`);
    } catch { setError("Could not create room. Check the server connection."); }
  };
  const join = async (event) => {
    event.preventDefault(); setError("");
    if (!isValidRoomCode(joinCode)) return setError("Enter a valid 6-character room code.");
    const normalized = normalizeRoomCode(joinCode);
    const result = await joinRoom(normalized, displayName.trim() || "Guest", needPassword ? joinPassword : undefined);
    if (result.ok) return navigate(`/room/${normalized}`);
    if (result.error === "password_required" || result.error === "incorrect_password") {
      setNeedPassword(true); setError(result.error === "incorrect_password" ? "Incorrect password. Try again." : "This room requires a password.");
    } else setError("Could not join room. Check the code or try again.");
  };
  const startMeeting = async () => {
    setError(""); setBusy(true);
    try {
      const { meeting, participantId } = await meetingApi.createMeeting();
      sessionStorage.setItem(MEETING_STORAGE_KEY, JSON.stringify({ code: meeting.code, participantId, isHost: true }));
      navigate(`/meet/${meeting.code}`);
    } catch { setError("Could not start a meeting."); }
    finally { setBusy(false); }
  };
  const joinMeeting = (event) => {
    event.preventDefault(); setError("");
    const code = parseMeetingCodeInput(meetInput);
    if (!isValidMeetingCode(code)) return setError("Enter a valid meeting link or 6-character code.");
    sessionStorage.removeItem(MEETING_STORAGE_KEY);
    navigate(`/meet/${code}`);
  };
  if (view === "recent") return <RecentRooms />;
  if (view === "meet") return <div className="ds-form-view"><div className="ds-form-heading"><Video className="ds-heading-icon" size={40} /><h1>Video <em>Meetings</em></h1><p>Connect face to face in a temporary call.</p></div>
    <div className="ds-form-card"><button className="ds-primary-button" disabled={busy} onClick={startMeeting}>{busy ? "Starting..." : "Start a Meeting"}</button><div className="ds-divider-text">or join an existing meeting</div><form onSubmit={joinMeeting}><label htmlFor="meeting-code">Meeting link or code</label><input id="meeting-code" className="ds-field" value={meetInput} onChange={(e) => setMeetInput(e.target.value)} placeholder="ABC-DEF" /><button className="ds-secondary-button" type="submit">Join Meeting</button></form>{error && <p className="ds-form-error">{error}</p>}</div></div>;
  const isCreate = view === "create";
  return <div className="ds-form-view"><div className="ds-form-heading">{isCreate ? <PlusCircle className="ds-heading-icon" size={42} /> : <UsersRound className="ds-heading-icon" size={42} />}<h1>{isCreate ? <>Create a <em>Room</em></> : <>Join a <em>Room</em></>}</h1><p>{isCreate ? "Set up your collaboration space in seconds." : "Enter a room code shared by your teammate."}</p></div>
    {isCreate ? <form className="ds-form-card" onSubmit={create}>
      <label htmlFor="room-name">Room Name</label><input id="room-name" className="ds-field" value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={60} placeholder="e.g. DSA Study Group" />
      <label className="ds-label-spaced" htmlFor="room-duration">Room Duration</label>
      <div className="ds-duration-row">{choices.map(({ label, minutes }) => <button key={minutes} type="button" className={`ds-duration ${!customDuration && Number(durationMinutes) === minutes ? "selected" : ""}`} onClick={() => { setDurationMinutes(minutes); setCustomDuration(false); }}>{label}</button>)}<button type="button" className={`ds-duration ${customDuration ? "selected" : ""}`} onClick={() => setCustomDuration(true)}><Clock3 size={15} />Custom</button></div>
      {customDuration && <div className="ds-custom-duration"><input id="room-duration" className="ds-field" type="number" min="5" max="1440" step="1" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} /><span>minutes · 5 min to 24 hours</span></div>}
      <div className="ds-password-toggle"><LockKeyhole size={18} /><span><strong>Require Room Password</strong><small>Only people with the password can join</small></span><button type="button" className={`ds-switch ${passwordOn ? "on" : ""}`} role="switch" aria-checked={passwordOn} aria-label="Require room password" onClick={() => setPasswordOn(!passwordOn)}><span /></button></div>
      {passwordOn && <><label className="ds-label-spaced" htmlFor="create-password">Room Password</label><input id="create-password" className="ds-field" type="password" minLength={4} maxLength={64} value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} placeholder="At least 4 characters" autoComplete="new-password" /></>}
      {error && <p className="ds-form-error">{error}</p>}
      <button className="ds-primary-button" type="submit" disabled={isLoading}>{isLoading ? "Creating..." : "Create Room"}</button>
      <p className="ds-form-note"><Check size={14} />Files and activity remain available for 24 hours after expiry.</p>
    </form> : <form className="ds-form-card ds-join-card" onSubmit={join}>
      <label htmlFor="join-code">Room Code</label><input id="join-code" className="ds-field ds-code-field" value={joinCode} onChange={(e) => { setJoinCode(normalizeRoomCode(e.target.value)); setError(""); }} maxLength={6} placeholder="DSA42X" autoComplete="off" spellCheck="false" autoFocus />
      <label className="ds-label-spaced" htmlFor="join-name">Your Name <span className="ds-optional">optional</span></label><input id="join-name" className="ds-field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} placeholder="How should teammates see you?" />
      {needPassword && <><label className="ds-label-spaced" htmlFor="join-password">Room Password</label><input id="join-password" className="ds-field" type="password" value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} maxLength={64} autoComplete="current-password" placeholder="Enter room password" /></>}
      {error && <p className="ds-form-error">{error}</p>}
      <button className="ds-primary-button" type="submit" disabled={isLoading}>{isLoading ? "Joining..." : "Join Room"}</button>
    </form>}
    <button className="ds-text-link ds-back-link" onClick={() => navigate("/")}>← Back to home</button>
  </div>;
}
