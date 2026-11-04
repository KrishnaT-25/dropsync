import { CloudUpload, PlusCircle, Radio, ShieldCheck, UsersRound, Video } from "lucide-react";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { Header } from "../components/layout/Header";
import { EntryTabs } from "../components/home/EntryTabs";
import { useRoom } from "../context/RoomContext";
import { isValidMeetingCode, normalizeMeetingCode } from "../utils/meetingCode";
import { isValidRoomCode, normalizeRoomCode } from "../utils/roomCode";

const features = [
  { icon: Radio, title: "Real-Time", second: "Collaboration" },
  { icon: CloudUpload, title: "Temporary", second: "Cloud Storage" },
  { icon: Video, title: "Audio &", second: "Video Calls" },
  { icon: ShieldCheck, title: "Secure &", second: "Private" },
];

export function HomePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { joinRoom } = useRoom();
  const view = searchParams.get("view") || (searchParams.get("joinCode") ? "join" : "home");
  useEffect(() => {
    const meetCode = searchParams.get("meet");
    if (meetCode && isValidMeetingCode(meetCode)) {
      navigate(`/meet/${normalizeMeetingCode(meetCode)}`, { replace: true });
      return;
    }
    const joinCode = searchParams.get("join");
    if (!joinCode || !isValidRoomCode(joinCode) || searchParams.get("needPassword") === "1") return;
    const normalized = normalizeRoomCode(joinCode);
    void joinRoom(normalized).then((result) => {
      if (result.ok) navigate(`/room/${normalized}`, { replace: true });
      else if (result.error === "password_required") navigate(`/?view=join&joinCode=${normalized}&needPassword=1`, { replace: true });
    });
  }, [searchParams, joinRoom, navigate]);

  return <AppShell>
    <Header />
    <main className={`ds-home-main ${view === "home" ? "ds-home-hero" : "ds-home-form"}`}>
      {view === "home" ? <>
        <div className="ds-hero-copy">
          <span className="ds-eyebrow">01 — YOUR WORKSPACE</span>
          <h1>Share · Collaborate · Sync<br />in <span>Real-Time</span></h1>
          <p>A temporary space for files, code, links and conversations.</p>
        </div>
        <div className="ds-feature-row">{features.map(({ icon: Icon, title, second }) => <div className="ds-feature" key={title}><span className="ds-feature-icon"><Icon size={22} /></span><strong>{title}<br />{second}</strong></div>)}</div>
        <div className="ds-entry-cards">
          <button className="ds-entry-card" onClick={() => navigate("/?view=join")}><UsersRound size={34} /><strong>Join a Room</strong><span>Enter a room code to collaborate</span></button>
          <button className="ds-entry-card" onClick={() => navigate("/?view=create")}><PlusCircle size={36} /><strong>Create a Room</strong><span>Start a new room and invite others</span></button>
        </div>
        <button className="ds-text-link ds-meet-link" onClick={() => navigate("/?view=meet")}>Looking for a video call? Open meetings <span aria-hidden>↗</span></button>
      </> : <EntryTabs view={view} />}
    </main>
  </AppShell>;
}
