import { jsx, jsxs } from "react/jsx-runtime";
import { MoreVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMeetingSession } from "../../context/MeetingSessionContext";
function HostParticipantMenu({ participantId, participantName }) {
  const { isHost, hostMute, hostRemove } = useMeetingSession();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  if (!isHost) return null;
  return /* @__PURE__ */ jsxs("div", { ref: rootRef, className: "relative", children: [
    /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        onClick: () => setOpen((v) => !v),
        className: "inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/20 bg-black/40 text-white/90 hover:bg-black/60",
        "aria-label": `Controls for ${participantName}`,
        children: /* @__PURE__ */ jsx(MoreVertical, { className: "h-3.5 w-3.5" })
      }
    ),
    open && /* @__PURE__ */ jsxs(
      "div",
      {
        className: "absolute right-0 bottom-9 z-10 min-w-[140px] rounded-xl border py-1 shadow-lg",
        style: { background: "var(--bg-elevated)", borderColor: "var(--border)" },
        children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "block w-full px-3 py-2 text-left text-xs hover:bg-black/10",
              style: { color: "var(--text-primary)" },
              onClick: () => {
                hostMute(participantId);
                setOpen(false);
              },
              children: "Mute"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "block w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-black/10",
              onClick: () => {
                hostRemove(participantId);
                setOpen(false);
              },
              children: "Remove"
            }
          )
        ]
      }
    )
  ] });
}
export {
  HostParticipantMenu
};
