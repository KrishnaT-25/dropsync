import { jsx } from "react/jsx-runtime";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import * as meetingApi from "../services/meetingApi";
import * as meetingSocket from "../services/meetingSocket";
import { normalizeMeetingCode } from "../utils/meetingCode";
const MeetingSessionContext = createContext(null);
const STORAGE_KEY = "dropsync-meeting-session";
function loadStored() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function saveStored(session) {
  if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(STORAGE_KEY);
}
function mapMeeting(api, selfId) {
  return {
    code: api.code,
    hostParticipantId: api.hostParticipantId,
    createdAt: api.createdAt,
    expiresAt: api.expiresAt,
    participants: api.participants.map((p) => ({
      ...p,
      isYou: p.id === selfId
    }))
  };
}
function MeetingSessionProvider({ children }) {
  const [meeting, setMeeting] = useState(null);
  const [participantId, setParticipantId] = useState(null);
  const [isJoined, setIsJoined] = useState(false);
  const [connection, setConnection] = useState({ connected: false, error: null });
  const [exitReason, setExitReason] = useState(null);
  const [activityLog, setActivityLog] = useState([]);
  const [rateLimitHint, setRateLimitHint] = useState(null);
  const participantIdRef = useRef(null);
  const isHostRef = useRef(false);
  useEffect(() => {
    participantIdRef.current = participantId;
  }, [participantId]);
  const isHost = Boolean(
    meeting && participantId && meeting.hostParticipantId === participantId
  );
  isHostRef.current = isHost;
  const applyMeeting = useCallback((api, selfId) => {
    setMeeting(mapMeeting(api, selfId));
  }, []);
  useEffect(() => {
    const handleState = (api) => {
      applyMeeting(api, participantIdRef.current);
      setConnection({ connected: true, error: null });
    };
    const handlePeerJoined = (payload) => {
      applyMeeting(payload.meeting, participantIdRef.current);
    };
    const handlePeerLeft = (payload) => {
      applyMeeting(payload.meeting, participantIdRef.current);
    };
    const handleActivity = (payload) => {
      setActivityLog((prev) => [
        ...prev,
        { ...payload, id: crypto.randomUUID() }
      ]);
    };
    const handleForceMuted = (payload) => {
      if (payload.targetParticipantId === participantIdRef.current) {
        window.dispatchEvent(new CustomEvent("dropsync-force-mute"));
      }
    };
    const handleRemoved = () => {
      setIsJoined(false);
      setMeeting(null);
      setParticipantId(null);
      saveStored(null);
      setExitReason("removed");
      setConnection({ connected: false, error: null });
    };
    const handleEnded = (payload) => {
      setIsJoined(false);
      setMeeting(null);
      setParticipantId(null);
      saveStored(null);
      setExitReason(payload.reason);
      setConnection({ connected: false, error: null });
    };
    meetingSocket.onMeetingState(handleState);
    meetingSocket.onPeerJoined(handlePeerJoined);
    meetingSocket.onPeerLeft(handlePeerLeft);
    meetingSocket.onMeetingActivity(handleActivity);
    meetingSocket.onForceMuted(handleForceMuted);
    meetingSocket.onRemovedByHost(handleRemoved);
    meetingSocket.onMeetingEnded(handleEnded);
    return () => {
      meetingSocket.offMeetingState(handleState);
      meetingSocket.offPeerJoined(handlePeerJoined);
      meetingSocket.offPeerLeft(handlePeerLeft);
      meetingSocket.offMeetingActivity(handleActivity);
      meetingSocket.offForceMuted(handleForceMuted);
      meetingSocket.offRemovedByHost(handleRemoved);
      meetingSocket.offMeetingEnded(handleEnded);
    };
  }, [applyMeeting]);
  const prepareAsHost = useCallback((code, pid) => {
    const normalized = normalizeMeetingCode(code);
    setParticipantId(pid);
    setIsJoined(false);
    setExitReason(null);
    setActivityLog([]);
    setMeeting({
      code: normalized,
      hostParticipantId: pid,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1e3).toISOString(),
      participants: [
        {
          id: pid,
          name: "Host",
          isHost: true,
          isMuted: false,
          isCameraOff: false,
          isScreenSharing: false,
          isYou: true
        }
      ]
    });
    saveStored({ code: normalized, participantId: pid, isHost: true });
    setConnection({ connected: false, error: null });
  }, []);
  const joinAsGuest = useCallback(
    async (code, displayName) => {
      const normalized = normalizeMeetingCode(code);
      try {
        const { meeting: apiMeeting, participantId: pid } = await meetingApi.joinMeeting(
          normalized,
          displayName.trim() || "Guest"
        );
        setParticipantId(pid);
        applyMeeting(apiMeeting, pid);
        saveStored({ code: normalized, participantId: pid, isHost: false });
        setExitReason(null);
        setActivityLog([]);
        setIsJoined(false);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Could not join meeting"
        };
      }
    },
    [applyMeeting]
  );
  const enterCall = useCallback(
    async (displayName) => {
      const stored = loadStored();
      const code = meeting?.code ?? stored?.code;
      const pid = participantId ?? stored?.participantId;
      if (!code || !pid) {
        return { ok: false, error: "Missing meeting session" };
      }
      const name = displayName.trim() || "Guest";
      const ack = await meetingSocket.joinMeetingSocket(code, pid, name);
      if (!ack.ok || !ack.meeting) {
        setConnection({ connected: false, error: ack.error ?? "Could not join meeting" });
        return { ok: false, error: ack.error ?? "Could not join meeting" };
      }
      applyMeeting(ack.meeting, pid);
      setParticipantId(pid);
      setIsJoined(true);
      setConnection({ connected: true, error: null });
      setExitReason(null);
      saveStored({
        code,
        participantId: pid,
        isHost: ack.meeting.hostParticipantId === pid
      });
      meetingSocket.emitMeetingActivity("joined the call");
      return { ok: true };
    },
    [applyMeeting, meeting?.code, participantId]
  );
  const leaveCall = useCallback(() => {
    if (isHostRef.current) {
      meetingSocket.emitHostEnd();
      setExitReason("host_ended");
    } else {
      meetingSocket.emitLeaveMeeting();
      setExitReason("left");
    }
    setIsJoined(false);
    setMeeting(null);
    setParticipantId(null);
    saveStored(null);
    setConnection({ connected: false, error: null });
  }, []);
  const endCallForEveryone = useCallback(() => {
    meetingSocket.emitHostEnd();
    setIsJoined(false);
    setMeeting(null);
    setParticipantId(null);
    saveStored(null);
    setExitReason("host_ended");
    setConnection({ connected: false, error: null });
  }, []);
  const hostMute = useCallback((targetParticipantId) => {
    meetingSocket.emitHostMute(targetParticipantId);
  }, []);
  const hostRemove = useCallback((targetParticipantId) => {
    meetingSocket.emitHostRemove(targetParticipantId);
  }, []);
  const emitMediaState = useCallback(
    (patch) => {
      if (!isJoined) return;
      meetingSocket.emitMeetingMediaState(patch);
    },
    [isJoined]
  );
  const emitActivity = useCallback(
    (content) => {
      if (!isJoined) return;
      void meetingSocket.emitMeetingActivity(content).then((ack) => {
        if (ack?.code === "rate_limited" || ack?.error === "Slow down a bit") {
          setRateLimitHint("Slow down a bit");
          window.setTimeout(() => setRateLimitHint(null), 3e3);
        }
      });
    },
    [isJoined]
  );
  const clearExit = useCallback(() => setExitReason(null), []);
  const hydrateFromStorage = useCallback(
    (code) => {
      const stored = loadStored();
      const normalized = normalizeMeetingCode(code);
      if (!stored || stored.code !== normalized) return false;
      setParticipantId(stored.participantId);
      setIsJoined(false);
      setExitReason(null);
      setMeeting({
        code: normalized,
        hostParticipantId: stored.isHost ? stored.participantId : "",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1e3).toISOString(),
        participants: stored.isHost ? [
          {
            id: stored.participantId,
            name: "Host",
            isHost: true,
            isMuted: false,
            isCameraOff: false,
            isScreenSharing: false,
            isYou: true
          }
        ] : []
      });
      setConnection({ connected: false, error: null });
      return true;
    },
    []
  );
  const value = useMemo(
    () => ({
      meeting,
      participantId,
      isHost,
      isJoined,
      connection,
      exitReason,
      activityLog,
      rateLimitHint,
      prepareAsHost,
      joinAsGuest,
      enterCall,
      leaveCall,
      endCallForEveryone,
      hostMute,
      hostRemove,
      emitMediaState,
      emitActivity,
      clearExit,
      hydrateFromStorage
    }),
    [
      meeting,
      participantId,
      isHost,
      isJoined,
      connection,
      exitReason,
      activityLog,
      rateLimitHint,
      prepareAsHost,
      joinAsGuest,
      enterCall,
      leaveCall,
      endCallForEveryone,
      hostMute,
      hostRemove,
      emitMediaState,
      emitActivity,
      clearExit,
      hydrateFromStorage
    ]
  );
  return /* @__PURE__ */ jsx(MeetingSessionContext.Provider, { value, children });
}
function useMeetingSession() {
  const ctx = useContext(MeetingSessionContext);
  if (!ctx) throw new Error("useMeetingSession must be used within MeetingSessionProvider");
  return ctx;
}
export {
  MeetingSessionProvider,
  useMeetingSession
};
