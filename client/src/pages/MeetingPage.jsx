import { jsx, jsxs } from "react/jsx-runtime";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MeetingEndedScreen } from "../components/meeting/MeetingEndedScreen";
import { MeetingLobby } from "../components/meeting/MeetingLobby";
import { MeetingPanel } from "../components/meeting/MeetingPanel";
import { AppShell } from "../components/layout/AppShell";
import { Header } from "../components/layout/Header";
import { MeetingProvider } from "../context/MeetingContext";
import { MeetingSessionProvider, useMeetingSession } from "../context/MeetingSessionContext";
import * as meetingApi from "../services/meetingApi";
import { isValidMeetingCode, normalizeMeetingCode } from "../utils/meetingCode";
function MeetingContent() {
  const { meetingCode: paramCode } = useParams();
  const navigate = useNavigate();
  const {
    meeting,
    participantId,
    isJoined,
    exitReason,
    joinAsGuest,
    enterCall,
    clearExit,
    hydrateFromStorage
  } = useMeetingSession();
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [bootError, setBootError] = useState("");
  useEffect(() => {
    if (!paramCode || !isValidMeetingCode(paramCode)) {
      navigate("/", { replace: true });
      return;
    }
    const code2 = normalizeMeetingCode(paramCode);
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setBootError("");
      hydrateFromStorage(code2);
      try {
        await meetingApi.getMeeting(code2);
        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) {
          setBootError("This meeting was not found or has ended.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paramCode, navigate, hydrateFromStorage]);
  if (exitReason) {
    return /* @__PURE__ */ jsx(AppShell, { centered: true, children: /* @__PURE__ */ jsx(MeetingEndedScreen, { reason: exitReason }) });
  }
  if (loading) {
    return /* @__PURE__ */ jsx(AppShell, { centered: true, children: /* @__PURE__ */ jsxs("div", { className: "flex flex-col items-center gap-3", children: [
      /* @__PURE__ */ jsx(Loader2, { className: "h-8 w-8 animate-spin text-accent" }),
      /* @__PURE__ */ jsx("p", { className: "text-sm", style: { color: "var(--text-muted)" }, children: "Loading meeting..." })
    ] }) });
  }
  if (bootError) {
    return /* @__PURE__ */ jsx(AppShell, { centered: true, children: /* @__PURE__ */ jsxs(
      "div",
      {
        className: "max-w-md rounded-2xl border p-6 text-center",
        style: { background: "var(--bg-card)", borderColor: "var(--border)" },
        children: [
          /* @__PURE__ */ jsx("p", { className: "mb-4 text-sm text-red-400", children: bootError }),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              onClick: () => {
                clearExit();
                navigate("/");
              },
              className: "rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-[#0b0e11]",
              children: "Back to home"
            }
          )
        ]
      }
    ) });
  }
  const code = normalizeMeetingCode(paramCode ?? "");
  const hostPrepared = Boolean(
    participantId && (meeting?.hostParticipantId === participantId || meeting?.participants.some((p) => p.id === participantId && p.isHost))
  );
  if (!isJoined) {
    return /* @__PURE__ */ jsxs(AppShell, { centered: true, children: [
      /* @__PURE__ */ jsx(Header, {}),
      /* @__PURE__ */ jsx("main", { className: "flex w-full flex-1 flex-col items-center px-4 pb-12 pt-2", children: /* @__PURE__ */ jsx(
        MeetingLobby,
        {
          isHost: hostPrepared,
          meetingCode: code,
          joining,
          onJoin: async (displayName) => {
            setJoining(true);
            try {
              if (!hostPrepared && !participantId) {
                const guest = await joinAsGuest(code, displayName);
                if (!guest.ok) return guest;
              }
              return await enterCall(displayName);
            } finally {
              setJoining(false);
            }
          }
        }
      ) })
    ] });
  }
  return /* @__PURE__ */ jsxs(AppShell, { children: [
    /* @__PURE__ */ jsx(
      Header,
      {
        showOnline: true,
        onlineCount: meeting?.participants.length,
        rightSlot: /* @__PURE__ */ jsx("span", { className: "rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs text-accent", children: "Live" })
      }
    ),
    /* @__PURE__ */ jsx("main", { className: "mx-auto w-full max-w-6xl flex-1 px-3 pb-6 sm:max-w-7xl sm:px-6", children: /* @__PURE__ */ jsx(MeetingPanel, {}) })
  ] });
}
function MeetingPage() {
  return /* @__PURE__ */ jsx(MeetingSessionProvider, { children: /* @__PURE__ */ jsx(MeetingProvider, { children: /* @__PURE__ */ jsx(MeetingContent, {}) }) });
}
export {
  MeetingPage
};
