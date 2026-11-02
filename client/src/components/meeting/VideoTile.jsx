import { jsx, jsxs } from "react/jsx-runtime";
import { Maximize2, MicOff, Minimize2, MonitorUp, Pin, PinOff, User, VideoOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
function VideoTile({
  tile,
  videoRef,
  hostMenu,
  size = "grid",
  pinned,
  onTogglePin,
  onToggleFullscreen,
  isBrowserFullscreen
}) {
  const internalRef = useRef(null);
  const ref = videoRef ?? internalRef;
  const isScreen = Boolean(tile.isScreenSharing) || tile.id === "screen-you";
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = tile.stream ?? null;
    if (tile.stream) {
      void video.play().catch(() => {
      });
    }
  }, [tile.stream, tile.isScreenSharing, ref]);
  useEffect(() => {
    const stream = tile.stream;
    if (!stream) return;
    const refresh = () => {
      const video = ref.current;
      if (!video) return;
      video.srcObject = stream;
      void video.play().catch(() => void 0);
    };
    stream.addEventListener("addtrack", refresh);
    stream.addEventListener("removetrack", refresh);
    const tracks = stream.getTracks();
    tracks.forEach((t) => {
      t.addEventListener("unmute", refresh);
      t.addEventListener("mute", refresh);
    });
    return () => {
      stream.removeEventListener("addtrack", refresh);
      stream.removeEventListener("removetrack", refresh);
      tracks.forEach((t) => {
        t.removeEventListener("unmute", refresh);
        t.removeEventListener("mute", refresh);
      });
    };
  }, [tile.stream, ref]);
  useEffect(() => {
    const video = ref.current;
    if (!video || tile.isYou) return;
    video.muted = Boolean(tile.isMuted);
  }, [tile.isMuted, tile.isYou, ref]);
  const showPlaceholder = !tile.stream || !isScreen && Boolean(tile.isCameraOff) || tile.stream.getVideoTracks().length === 0 && !isScreen;
  const shellClass = size === "stage" ? "relative h-full min-h-[280px] w-full overflow-hidden rounded-2xl border sm:min-h-[420px]" : size === "pip" ? "relative aspect-video w-[140px] shrink-0 overflow-hidden rounded-lg border sm:w-[168px]" : "relative aspect-video overflow-hidden rounded-xl border";
  const objectFit = isScreen && size === "stage" ? "object-contain" : "object-cover";
  const label = tile.id === "screen-you" ? "Your screen" : isScreen && !tile.isYou ? `${tile.name}'s screen` : tile.isYou ? "You" : tile.name;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: shellClass,
      style: {
        background: size === "stage" ? "#0a0c0f" : "var(--bg-elevated)",
        borderColor: pinned ? "var(--color-accent)" : "var(--border)",
        boxShadow: pinned ? "0 0 0 1px var(--color-accent)" : void 0
      },
      children: [
        /* @__PURE__ */ jsx(
          "video",
          {
            ref,
            autoPlay: true,
            playsInline: true,
            muted: tile.isYou || Boolean(tile.isMuted),
            className: `h-full w-full ${objectFit} ${showPlaceholder ? "hidden" : "block"}`
          }
        ),
        showPlaceholder && /* @__PURE__ */ jsx("div", { className: "absolute inset-0 flex h-full w-full items-center justify-center", children: /* @__PURE__ */ jsx(
          "div",
          {
            className: "flex h-14 w-14 items-center justify-center rounded-full",
            style: { background: "rgba(79, 209, 197, 0.15)" },
            children: isScreen ? /* @__PURE__ */ jsx(MonitorUp, { className: "h-6 w-6 text-accent" }) : /* @__PURE__ */ jsx(User, { className: "h-6 w-6 text-accent" })
          }
        ) }),
        /* @__PURE__ */ jsx("div", { className: "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2", children: /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between gap-2", children: [
          /* @__PURE__ */ jsxs("span", { className: "truncate text-xs font-medium text-white", children: [
            label,
            tile.isHost && !tile.isYou && !isScreen ? " \xB7 Host" : "",
            pinned ? " \xB7 Pinned" : ""
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
            tile.isMuted && /* @__PURE__ */ jsx(MicOff, { className: "h-3.5 w-3.5 text-red-400" }),
            tile.isCameraOff && !isScreen && /* @__PURE__ */ jsx(VideoOff, { className: "h-3.5 w-3.5 text-amber-300" }),
            isScreen && /* @__PURE__ */ jsx(MonitorUp, { className: "h-3.5 w-3.5 text-accent" }),
            onTogglePin && /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                onClick: (e) => {
                  e.stopPropagation();
                  onTogglePin();
                },
                className: "rounded-md p-1 text-white/90 transition hover:bg-white/10",
                "aria-label": pinned ? "Unpin" : "Pin",
                title: pinned ? "Unpin" : "Pin",
                children: pinned ? /* @__PURE__ */ jsx(PinOff, { className: "h-3.5 w-3.5 text-accent" }) : /* @__PURE__ */ jsx(Pin, { className: "h-3.5 w-3.5" })
              }
            ),
            !tile.isYou && tile.id !== "screen-you" && hostMenu,
            size === "stage" && onToggleFullscreen && /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                onClick: onToggleFullscreen,
                className: "rounded-md p-1 text-white/90 transition hover:bg-white/10",
                "aria-label": isBrowserFullscreen ? "Exit fullscreen" : "Fullscreen",
                title: isBrowserFullscreen ? "Exit fullscreen" : "Fullscreen",
                children: isBrowserFullscreen ? /* @__PURE__ */ jsx(Minimize2, { className: "h-3.5 w-3.5" }) : /* @__PURE__ */ jsx(Maximize2, { className: "h-3.5 w-3.5" })
              }
            )
          ] })
        ] }) })
      ]
    }
  );
}
function FullscreenExitHint({ onExit }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(false), 2500);
    return () => window.clearTimeout(t);
  }, []);
  if (!visible) return null;
  return /* @__PURE__ */ jsxs(
    "button",
    {
      type: "button",
      onClick: onExit,
      className: "absolute right-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white",
      children: [
        /* @__PURE__ */ jsx(X, { className: "h-3.5 w-3.5" }),
        "Esc to exit"
      ]
    }
  );
}
export {
  FullscreenExitHint,
  VideoTile
};
