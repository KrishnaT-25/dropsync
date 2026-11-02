import { jsx, jsxs } from "react/jsx-runtime";
import { ExpiryTimer } from "./ExpiryTimer";
import { ParticipantsList } from "./ParticipantsList";
import { RoomCodeDisplay } from "./RoomCodeDisplay";
function RoomSidebar({
  code,
  joinUrl,
  expiresAt,
  recoveryDeadline,
  status,
  participants,
  onLeave,
  onExpire
}) {
  return /* @__PURE__ */ jsx("aside", { className: "w-full lg:w-[320px] lg:shrink-0 xl:w-[340px]", children: /* @__PURE__ */ jsxs(
    "div",
    {
      className: "relative overflow-hidden rounded-2xl",
      style: {
        background: "var(--ticket-bg)",
        boxShadow: "var(--shadow-card)"
      },
      children: [
        /* @__PURE__ */ jsx(
          "div",
          {
            className: "pointer-events-none absolute left-0 top-[52%] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full",
            style: { background: "var(--bg)" }
          }
        ),
        /* @__PURE__ */ jsx(
          "div",
          {
            className: "pointer-events-none absolute right-0 top-[52%] h-4 w-4 translate-x-1/2 -translate-y-1/2 rounded-full",
            style: { background: "var(--bg)" }
          }
        ),
        /* @__PURE__ */ jsxs("div", { className: "p-5 sm:p-6", children: [
          /* @__PURE__ */ jsx(RoomCodeDisplay, { code, joinUrl }),
          /* @__PURE__ */ jsx(ExpiryTimer, { expiresAt, recoveryDeadline, status, onExpire })
        ] }),
        /* @__PURE__ */ jsx(
          "div",
          {
            className: "mx-5 border-t border-dashed sm:mx-6",
            style: { borderColor: "rgba(28, 25, 23, 0.15)" }
          }
        ),
        /* @__PURE__ */ jsx("div", { className: "p-5 sm:p-6", children: /* @__PURE__ */ jsx(ParticipantsList, { participants, onLeave }) })
      ]
    }
  ) });
}
export {
  RoomSidebar
};
