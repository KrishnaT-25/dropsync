import { Boxes, Moon, Sun, UsersRound, Video } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTheme } from "../../context/ThemeContext";

export function Header({ onlineCount = 0, showOnline = false, rightSlot, roomName, onCallClick }) {
  const { theme, toggleTheme } = useTheme();
  const { search } = useLocation();
  const view = new URLSearchParams(search).get("view");
  return <header className="ds-header">
    <div className="ds-header-left">
      <Link className="ds-brand" to="/" aria-label="DropSync home"><span className="ds-brand-mark"><Boxes size={21} strokeWidth={2} /></span><span>DropSync</span></Link>
      <span className="ds-header-divider" /><span className="ds-header-room">{roomName || "Workspace"}</span>
      {showOnline && <span className="ds-live"><span className="ds-live-dot" />Live</span>}
    </div>
    <nav className="ds-top-nav" aria-label="Main navigation">
      <Link className={view === "create" ? "active" : ""} to="/?view=create">Create Room</Link>
      <Link className={view === "join" ? "active" : ""} to="/?view=join">Join Room</Link>
      <Link className={view === "recent" ? "active" : ""} to="/?view=recent">Recent Rooms</Link>
    </nav>
    <div className="ds-header-actions">
      {showOnline && <span className="ds-online-count"><UsersRound size={16} />{onlineCount}</span>}
      {roomName && onCallClick && <button type="button" onClick={onCallClick} className="ds-icon-button" aria-label="Open room call" title="Room call"><Video size={17} /></button>}
      {rightSlot}
      <button className="ds-profile" type="button" onClick={toggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
        <span>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</span><span className="ds-theme-label">{theme === "dark" ? "Light" : "Dark"}</span>
      </button>
    </div>
  </header>;
}
