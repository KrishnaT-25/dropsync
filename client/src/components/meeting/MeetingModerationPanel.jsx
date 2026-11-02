import { useState } from "react";
import { Shield, UserCheck, UserX } from "lucide-react";
import { useMeetingSession } from "../../context/MeetingSessionContext";

export function MeetingModerationPanel() {
  const { meeting, isHost, isModerator, waitingRoom, admitParticipant, hostRemove, updatePermissions } = useMeetingSession();
  const [open, setOpen] = useState(false);
  if (!isModerator || !meeting) return null;

  const options = [
    { key: "requireAdmission", label: "Require admission", detail: "New guests wait for a host or co-host." },
    { key: "allowScreenShare", label: "Participant screen sharing", detail: "Allow guests to share their screen." },
    { key: "allowParticipantUnmute", label: "Participant unmute", detail: "Allow guests to turn their microphone back on." }
  ];

  return <section className="mb-4 rounded-2xl border p-3 sm:p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
    <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span className="flex items-center gap-2 text-sm font-semibold"><Shield size={17} className="text-accent" />Meeting controls</span>
      <span className="text-xs text-accent">{waitingRoom.length ? `${waitingRoom.length} waiting` : open ? "Hide" : "Show"}</span>
    </button>
    {open && <div className="mt-4 grid gap-5 border-t pt-4 md:grid-cols-2" style={{ borderColor: "var(--border)" }}>
      <div>
        <h2 className="mb-2 text-sm font-semibold">Waiting room</h2>
        {waitingRoom.length === 0 ? <p className="text-xs" style={{ color: "var(--text-muted)" }}>No one is waiting.</p> :
          <ul className="space-y-2">{waitingRoom.map((person) => <li key={person.id} className="flex items-center justify-between gap-2 rounded-xl border p-2" style={{ borderColor: "var(--border)" }}>
            <span className="min-w-0 truncate text-sm">{person.name}</span>
            <span className="flex shrink-0 gap-1">
              <button type="button" onClick={() => admitParticipant(person.id)} className="rounded-lg border px-2 py-1 text-xs text-accent" style={{ borderColor: "var(--border)" }}><UserCheck size={14} className="inline" /> Admit</button>
              <button type="button" onClick={() => hostRemove(person.id)} className="rounded-lg border px-2 py-1 text-xs text-red-500" style={{ borderColor: "var(--border)" }}><UserX size={14} className="inline" /> Deny</button>
            </span>
          </li>)}</ul>}
      </div>
      {isHost && <div>
        <h2 className="mb-2 text-sm font-semibold">Permissions</h2>
        <div className="space-y-3">{options.map((option) => <label key={option.key} className="flex cursor-pointer items-start justify-between gap-3 text-sm">
          <span><span className="block font-medium">{option.label}</span><span className="block text-xs" style={{ color: "var(--text-muted)" }}>{option.detail}</span></span>
          <input type="checkbox" className="mt-1 accent-teal-600" checked={Boolean(meeting.permissions?.[option.key])} onChange={(event) => updatePermissions({ [option.key]: event.target.checked })} />
        </label>)}</div>
      </div>}
    </div>}
  </section>;
}
