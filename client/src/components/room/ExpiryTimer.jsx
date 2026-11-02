import { jsx, jsxs } from "react/jsx-runtime";
import { Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatCountdown } from "../../utils/formatTime";
function ExpiryTimer({ expiresAt, recoveryDeadline, status, onExpire }) {
  const firedRef = useRef(null);
  const [secondsLeft, setSecondsLeft] = useState(
    () => Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1e3))
  );
  useEffect(() => {
    const tick = () => {
      const next = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1e3));
      setSecondsLeft(next);
      if (next === 0 && firedRef.current !== expiresAt.getTime()) {
        firedRef.current = expiresAt.getTime();
        onExpire?.();
      }
    };
    tick();
    const id = window.setInterval(tick, 1e3);
    return () => window.clearInterval(id);
  }, [expiresAt, onExpire]);
  if (status !== "active") return /* @__PURE__ */ jsx("p", { className: "mb-5 text-sm", style: { color: "var(--ticket-muted)" }, children: `Recovery until ${recoveryDeadline?.toLocaleString() ?? "deadline"}` });
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "mb-5 inline-flex items-center gap-2 text-sm",
      style: { color: "var(--ticket-muted)" },
      children: [
        /* @__PURE__ */ jsx(Clock, { className: "h-4 w-4" }),
        /* @__PURE__ */ jsxs("span", { children: [
          "expires in",
          " ",
          /* @__PURE__ */ jsx("span", { className: "font-mono font-semibold", children: formatCountdown(secondsLeft) })
        ] })
      ]
    }
  );
}
export {
  ExpiryTimer
};
