import { ArrowRight, CloudUpload, Clock3, Code2, Link2, UsersRound, Video } from "lucide-react";
import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { Header } from "../components/layout/Header";
import { EntryTabs } from "../components/home/EntryTabs";
import { useRoom } from "../context/RoomContext";
import { isValidMeetingCode, normalizeMeetingCode } from "../utils/meetingCode";
import { isValidRoomCode, normalizeRoomCode } from "../utils/roomCode";

const features = [
  { icon: CloudUpload, label: "Share files" },
  { icon: Code2, label: "Paste code" },
  { icon: Link2, label: "Collect links" },
  { icon: Clock3, label: "Set an expiry" },
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
    <a className="ds-skip-link" href="#main-content">Skip to main content</a>
    <Header />
    <main id="main-content" tabIndex={-1} className={`ds-home-main ${view === "home" ? "ds-home-hero" : "ds-home-form"}`}>
      {view === "home" ? <>
        <div className="ds-home-intro">
          <div className="ds-hero-copy">
            <h1>A temporary room for everything you’re sharing.</h1>
            <p>Bring files, code, links and conversation into one temporary room. Set how long it stays open, then share the room code with your team.</p>
          </div>
          <section className="ds-home-actions" aria-labelledby="ds-home-actions-title">
            <div className="ds-home-actions-top"><span className="ds-home-actions-mark" aria-hidden="true"><UsersRound size={22} /></span><span>Temporary rooms</span></div>
            <h2 id="ds-home-actions-title">Start sharing</h2>
            <p>Create a room for your team, or use a code to join one.</p>
            <Link className="ds-home-action ds-home-action-primary" to="/?view=create"><span><strong>Create a Room</strong><small>Choose a name and expiry</small></span><ArrowRight size={20} aria-hidden="true" /></Link>
            <Link className="ds-home-action ds-home-action-secondary" to="/?view=join"><span><strong>Join a Room</strong><small>Enter a code from your team</small></span><ArrowRight size={20} aria-hidden="true" /></Link>
            <Link className="ds-home-meet-link" to="/?view=meet"><Video size={18} aria-hidden="true" /> Need a video call? Open meetings <ArrowRight size={16} aria-hidden="true" /></Link>
          </section>
        </div>
        <div className="ds-home-capabilities" aria-label="What you can do in a room">{features.map(({ icon: Icon, label }) => <div className="ds-home-capability" key={label}><Icon size={19} aria-hidden="true" /><span>{label}</span></div>)}</div>
      </> : <EntryTabs view={view} />}
    </main>
  </AppShell>;
}
