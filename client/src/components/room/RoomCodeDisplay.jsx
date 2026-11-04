import { jsx, jsxs } from "react/jsx-runtime";
import { Copy, Check } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { getRoomCodeChars } from "../../utils/roomCode";
function RoomCodeDisplay({ code, joinUrl }) {
  const [copied, setCopied] = useState(false);
  const chars = getRoomCodeChars(code);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code.replace(/-/g, "").slice(0, 6));
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    } catch {
      setCopied(false);
    }
  };
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsx(
      "p",
      {
        className: "mb-3 text-[11px] font-semibold uppercase tracking-[0.2em]",
        style: { color: "var(--ticket-muted)" },
        children: "Room code"
      }
    ),
    /* @__PURE__ */ jsx("div", { className: "mb-4 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2", children: chars.map((char, index) => /* @__PURE__ */ jsx(
      "span",
      {
        className: "flex h-9 w-9 items-center justify-center rounded-lg font-mono text-sm font-bold text-white sm:h-10 sm:w-10 sm:text-base",
        style: { background: "#0b0e11" },
        children: char
      },
      `${char}-${index}`
    )) }),
    /* @__PURE__ */ jsxs("div", { className: "flex flex-col items-center gap-4 sm:flex-row sm:items-start", children: [
      /* @__PURE__ */ jsxs("div", { className: "text-center", children: [
        /* @__PURE__ */ jsx("div", { className: "rounded-xl bg-white p-2.5", children: /* @__PURE__ */ jsx(QRCodeSVG, { value: joinUrl, size: 112, level: "M" }) }),
        /* @__PURE__ */ jsx("p", { className: "mt-2 text-[11px]", style: { color: "var(--ticket-muted)" }, children: "Scan to join" })
      ] }),
      /* @__PURE__ */ jsxs(
        "button",
        {
          type: "button",
          onClick: handleCopy,
          className: "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 active:scale-[0.98]",
          style: { background: "#0b0e11" },
          children: [
            copied ? /* @__PURE__ */ jsx(Check, { className: "h-4 w-4" }) : /* @__PURE__ */ jsx(Copy, { className: "h-4 w-4" }),
            copied ? "Copied!" : "Copy code"
          ]
        }
      )
    ] })
  ] });
}
export {
  RoomCodeDisplay
};
