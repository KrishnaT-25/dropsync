import { jsx, jsxs } from "react/jsx-runtime";
import { Copy, Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMeeting } from "../../context/MeetingContext";
import { useMeetingSession } from "../../context/MeetingSessionContext";
import { HostParticipantMenu } from "./HostParticipantMenu";
import { MeetingControls } from "./MeetingControls";
import { FullscreenExitHint, VideoTile } from "./VideoTile";
function pickScreenStage(tiles) {
  const localScreen = tiles.find((t) => t.id === "screen-you" && t.stream);
  if (localScreen) return localScreen;
  return tiles.find((t) => Boolean(t.isScreenSharing) && Boolean(t.stream) && !t.isYou) ?? tiles.find((t) => Boolean(t.isScreenSharing) && Boolean(t.stream)) ?? null;
}
function pickStage(tiles, pinnedId) {
  if (pinnedId) {
    const pinned = tiles.find((t) => t.id === pinnedId && t.stream);
    if (pinned) return pinned;
  }
  return pickScreenStage(tiles);
}
function MeetingPanel() {
  const { error, tiles, localVideoRef, screenVideoRef } = useMeeting();
  const { meeting, isHost, activityLog, participantId, rateLimitHint } = useMeetingSession();
  const [copied, setCopied] = useState(false);
  const [browserFs, setBrowserFs] = useState(false);
  const [pinnedId, setPinnedId] = useState(null);
  const stageShellRef = useRef(null);
  const prevScreenIdRef = useRef(null);
  const inviteUrl = meeting ? `${window.location.origin}/meet/${meeting.code}` : "";
  const activeScreen = useMemo(() => pickScreenStage(tiles), [tiles]);
  useEffect(() => {
    const id = activeScreen?.id ?? null;
    if (id && id !== prevScreenIdRef.current) {
      setPinnedId(null);
    }
    prevScreenIdRef.current = id;
  }, [activeScreen?.id]);
  const stageTile = useMemo(() => pickStage(tiles, pinnedId), [tiles, pinnedId]);
  const stripTiles = useMemo(() => {
    if (!stageTile) return tiles;
    return tiles.filter((t) => t.id !== stageTile.id);
  }, [tiles, stageTile]);
  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
    }
  };
  useEffect(() => {
    const onFsChange = () => {
      setBrowserFs(document.fullscreenElement === stageShellRef.current);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);
  const toggleFullscreen = useCallback(async () => {
    const el = stageShellRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
    }
  }, []);
  const togglePin = useCallback((tileId) => {
    setPinnedId((prev) => prev === tileId ? null : tileId);
  }, []);
  const renderTile = (tile, size) => /* @__PURE__ */ jsx(
    VideoTile,
    {
      tile,
      size,
      pinned: pinnedId === tile.id,
      onTogglePin: () => togglePin(tile.id),
      videoRef: tile.id === "screen-you" ? screenVideoRef : tile.isYou && tile.id !== "screen-you" ? localVideoRef : void 0,
      isBrowserFullscreen: size === "stage" ? browserFs : void 0,
      onToggleFullscreen: size === "stage" ? () => void toggleFullscreen() : void 0,
      hostMenu: !tile.isYou && tile.id !== "screen-you" ? /* @__PURE__ */ jsx(HostParticipantMenu, { participantId: tile.id, participantName: tile.name }) : void 0
    },
    tile.id
  );
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "rounded-2xl border p-3 sm:p-5",
      style: {
        background: "var(--bg-elevated)",
        borderColor: "var(--border)"
      },
      children: [
        /* @__PURE__ */ jsxs("div", { className: "mb-3 flex flex-wrap items-center justify-between gap-3 sm:mb-4", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx(
              "p",
              {
                className: "text-[11px] font-semibold uppercase tracking-[0.2em]",
                style: { color: "var(--text-muted)" },
                children: "Live meeting"
              }
            ),
            meeting && /* @__PURE__ */ jsxs("p", { className: "mt-1 font-mono text-sm text-accent", children: [
              meeting.code.slice(0, 3),
              "-",
              meeting.code.slice(3),
              isHost ? " \xB7 Host" : ""
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                onClick: () => void copyInvite(),
                className: "inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition",
                style: {
                  borderColor: "var(--border)",
                  color: "var(--text-secondary)",
                  background: "var(--bg-card)"
                },
                children: [
                  copied ? /* @__PURE__ */ jsx(Check, { className: "h-3.5 w-3.5 text-accent" }) : /* @__PURE__ */ jsx(Copy, { className: "h-3.5 w-3.5" }),
                  copied ? "Copied" : "Copy link"
                ]
              }
            ),
            /* @__PURE__ */ jsxs("span", { className: "inline-flex items-center gap-2 text-xs", style: { color: "var(--text-secondary)" }, children: [
              /* @__PURE__ */ jsxs("span", { className: "relative flex h-2 w-2", children: [
                /* @__PURE__ */ jsx("span", { className: "absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" }),
                /* @__PURE__ */ jsx("span", { className: "relative inline-flex h-2 w-2 rounded-full bg-red-500" })
              ] }),
              "In call"
            ] })
          ] })
        ] }),
        stageTile ? /* @__PURE__ */ jsxs("div", { className: "mb-3 flex flex-col gap-3 sm:mb-4", children: [
          /* @__PURE__ */ jsxs(
            "div",
            {
              ref: stageShellRef,
              className: "relative h-[min(68vh,720px)] w-full bg-black sm:h-[min(72vh,820px)]",
              children: [
                renderTile(stageTile, "stage"),
                browserFs && /* @__PURE__ */ jsx(FullscreenExitHint, { onExit: () => void document.exitFullscreen() })
              ]
            }
          ),
          stripTiles.length > 0 && /* @__PURE__ */ jsx("div", { className: "flex gap-2 overflow-x-auto pb-1", children: stripTiles.map((tile) => renderTile(tile, "pip")) })
        ] }) : /* @__PURE__ */ jsx("div", { className: "mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3", children: tiles.map((tile) => renderTile(tile, "grid")) }),
        /* @__PURE__ */ jsx(MeetingControls, {}),
        error && /* @__PURE__ */ jsx("p", { className: "mt-3 text-center text-sm text-red-400", children: error }),
        rateLimitHint && /* @__PURE__ */ jsx("p", { className: "mt-2 text-center text-xs", style: { color: "var(--text-muted)" }, children: rateLimitHint }),
        activityLog.length > 0 && /* @__PURE__ */ jsx("ul", { className: "mt-4 space-y-1 border-t pt-3", style: { borderColor: "var(--border)" }, children: activityLog.slice(-6).map((item) => {
          const who = item.actorId === participantId ? "You" : item.actorName;
          return /* @__PURE__ */ jsxs("li", { className: "text-center text-xs", style: { color: "var(--text-muted)" }, children: [
            who,
            " ",
            item.content
          ] }, item.id);
        }) })
      ]
    }
  );
}
export {
  MeetingPanel
};
