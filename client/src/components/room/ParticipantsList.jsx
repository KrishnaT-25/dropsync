import { jsx, jsxs } from "react/jsx-runtime";
import { LogOut, Users } from "lucide-react";
function ParticipantsList({ participants, onLeave }) {
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsxs(
      "div",
      {
        className: "mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em]",
        style: { color: "var(--ticket-muted)" },
        children: [
          /* @__PURE__ */ jsx(Users, { className: "h-3.5 w-3.5" }),
          "Participants"
        ]
      }
    ),
    /* @__PURE__ */ jsx("ul", { className: "space-y-2.5", children: participants.map((participant) => /* @__PURE__ */ jsx(
      "li",
      {
        className: "flex items-center justify-between gap-2 text-sm font-medium",
        style: { color: "var(--ticket-text)" },
        children: /* @__PURE__ */ jsxs("div", { className: "flex min-w-0 items-center gap-2", children: [
          /* @__PURE__ */ jsx("span", { className: "h-2 w-2 shrink-0 rounded-full bg-accent" }),
          /* @__PURE__ */ jsx("span", { className: "truncate", children: participant.isYou ? "You" : participant.name === "You" ? "Host" : participant.name })
        ] })
      },
      participant.id
    )) }),
    /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        onClick: onLeave,
        className: "mt-5 inline-flex items-center gap-2 text-sm font-medium text-red-500 transition hover:text-red-400",
        children: [
          /* @__PURE__ */ jsx(LogOut, { className: "h-4 w-4" }),
          "Leave room"
        ]
      }
    )
  ] });
}
export {
  ParticipantsList
};
