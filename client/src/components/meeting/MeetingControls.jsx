import { jsx, jsxs } from "react/jsx-runtime";
import {
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Video,
  VideoOff
} from "lucide-react";
import { useMeeting } from "../../context/MeetingContext";
import { useMeetingSession } from "../../context/MeetingSessionContext";
function MeetingControls() {
  const {
    isMuted,
    isCameraOff,
    isScreenSharing,
    canShareScreen,
    canUnmute,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    leaveOrEnd
  } = useMeeting();
  const { isHost } = useMeetingSession();
  const buttons = [
    {
      label: isMuted ? "Unmute" : "Mute",
      icon: isMuted ? MicOff : Mic,
      active: isMuted,
      disabled: isMuted && !canUnmute,
      onClick: toggleMute
    },
    {
      label: isCameraOff ? "Camera on" : "Camera off",
      icon: isCameraOff ? VideoOff : Video,
      active: isCameraOff,
      onClick: toggleCamera
    },
    {
      label: isScreenSharing ? "Stop share" : "Share screen",
      icon: MonitorUp,
      active: isScreenSharing,
      disabled: !isScreenSharing && !canShareScreen,
      onClick: () => {
        void toggleScreenShare();
      }
    }
  ];
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center justify-center gap-2 sm:gap-3", children: [
    buttons.map(({ label, icon: Icon, active, disabled, onClick }) => /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        onClick,
        disabled,
        "aria-label": label,
        title: label,
        className: "inline-flex h-11 w-11 items-center justify-center rounded-xl border transition hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:h-12 sm:w-12",
        style: {
          background: active ? "rgba(248, 113, 113, 0.12)" : "var(--bg-elevated)",
          borderColor: active ? "rgba(248, 113, 113, 0.35)" : "var(--border)",
          color: active ? "#f87171" : "var(--text-secondary)"
        },
        children: /* @__PURE__ */ jsx(Icon, { className: "h-5 w-5" })
      },
      label
    )),
    /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        onClick: leaveOrEnd,
        "aria-label": isHost ? "End meeting" : "Leave meeting",
        title: isHost ? "End meeting for everyone" : "Leave meeting",
        className: "inline-flex h-11 items-center gap-2 rounded-xl bg-red-500 px-4 text-sm font-semibold text-white transition hover:bg-red-400 active:scale-95 sm:h-12 sm:px-5",
        children: [
          /* @__PURE__ */ jsx(PhoneOff, { className: "h-4 w-4" }),
          /* @__PURE__ */ jsx("span", { className: "hidden sm:inline", children: isHost ? "End" : "Leave" })
        ]
      }
    )
  ] });
}
export {
  MeetingControls
};
