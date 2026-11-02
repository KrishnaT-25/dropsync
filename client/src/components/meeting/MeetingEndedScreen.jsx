import { jsx, jsxs } from "react/jsx-runtime";
import { useNavigate } from "react-router-dom";
function MeetingEndedScreen({ reason }) {
  const navigate = useNavigate();
  const message = reason === "removed" ? "You were removed from the meeting by the host." : reason === "host_ended" ? "The meeting was ended by the host." : reason === "host_left" ? "The host left \u2014 this meeting has ended." : "You left the meeting.";
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "mx-auto w-full max-w-md rounded-2xl border p-6 text-center",
      style: {
        background: "var(--bg-card)",
        borderColor: "var(--border)",
        boxShadow: "var(--shadow-card)"
      },
      children: [
        /* @__PURE__ */ jsx("h1", { className: "mb-2 text-xl font-semibold", style: { color: "var(--text-primary)" }, children: "Meeting ended" }),
        /* @__PURE__ */ jsx("p", { className: "mb-6 text-sm", style: { color: "var(--text-secondary)" }, children: message }),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: () => navigate("/"),
            className: "inline-flex items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-[#0b0e11] transition hover:bg-accent-hover",
            children: "Back to home"
          }
        )
      ]
    }
  );
}
export {
  MeetingEndedScreen
};
