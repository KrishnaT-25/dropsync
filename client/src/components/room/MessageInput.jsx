import { jsx, jsxs } from "react/jsx-runtime";
import { Clipboard, Code2, Paperclip, Send } from "lucide-react";
import { useRef, useState } from "react";
function MessageInput({
  onSend,
  onSendClipboard,
  onSendCode,
  onSendFile,
  rateLimitHint
}) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState("text");
  const [clipboardStatus, setClipboardStatus] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const retryRef = useRef(null);
  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    const id = retryRef.current?.content === trimmed ? retryRef.current.id : crypto.randomUUID();
    retryRef.current = null;
    setValue("");
    let sent = false;
    try { sent = await (mode === "code" ? onSendCode(trimmed, id) : onSend(trimmed, id)); }
    catch { sent = false; }
    if (!sent) {
      retryRef.current = { content: trimmed, id };
      setValue((current) => current || trimmed);
    }
  };
  const handleClipboard = async () => {
    setClipboardStatus(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setClipboardStatus("Clipboard is empty");
        return;
      }
      onSendClipboard(text.trim());
      setClipboardStatus("Clipboard synced");
      window.setTimeout(() => setClipboardStatus(null), 2e3);
    } catch {
      setClipboardStatus("Clipboard access denied");
    }
  };
  const handleFiles = (files) => {
    Array.from(files).forEach((file) => onSendFile(file));
  };
  const handleFileChange = (e) => {
    if (e.target.files?.length) {
      handleFiles(e.target.files);
      e.target.value = "";
    }
  };
  const handleDragOver = (e) => {
    e.preventDefault();
    setDragActive(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragActive(false);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  };
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "mt-4",
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
      children: [
        dragActive && /* @__PURE__ */ jsx("div", { className: "mb-2 rounded-xl border border-dashed border-accent bg-accent/10 px-4 py-3 text-center text-sm text-accent", children: "Drop files to share" }),
        rateLimitHint && /* @__PURE__ */ jsx("p", { className: "mb-2 text-xs", style: { color: "var(--text-muted)" }, children: rateLimitHint }),
        /* @__PURE__ */ jsxs("div", { className: "mb-2 flex items-center gap-2", children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              onClick: () => setMode("text"),
              className: "rounded-lg px-2.5 py-1 text-xs font-medium transition",
              style: {
                background: mode === "text" ? "rgba(79, 209, 197, 0.15)" : "transparent",
                color: mode === "text" ? "var(--color-accent)" : "var(--text-muted)"
              },
              children: "Message"
            }
          ),
          /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              onClick: () => setMode("code"),
              className: "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition",
              style: {
                background: mode === "code" ? "rgba(79, 209, 197, 0.15)" : "transparent",
                color: mode === "code" ? "var(--color-accent)" : "var(--text-muted)"
              },
              children: [
                /* @__PURE__ */ jsx(Code2, { className: "h-3.5 w-3.5" }),
                "Code"
              ]
            }
          ),
          clipboardStatus && /* @__PURE__ */ jsx("span", { className: "text-xs", style: { color: "var(--text-muted)" }, children: clipboardStatus })
        ] }),
        /* @__PURE__ */ jsx(
          "input",
          {
            ref: fileInputRef,
            type: "file",
            multiple: true,
            className: "hidden",
            onChange: handleFileChange
          }
        ),
        /* @__PURE__ */ jsxs(
          "form",
          {
            onSubmit: handleSubmit,
            className: "flex items-end gap-2 rounded-2xl border p-2 sm:gap-3 sm:p-2.5",
            style: {
              background: "var(--bg-elevated)",
              borderColor: "var(--border)"
            },
            children: [
              /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  onClick: () => fileInputRef.current?.click(),
                  "aria-label": "Attach file",
                  className: "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition hover:opacity-80",
                  style: { color: "var(--text-muted)" },
                  title: "Attach files",
                  children: /* @__PURE__ */ jsx(Paperclip, { className: "h-5 w-5" })
                }
              ),
              /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  onClick: () => {
                    void handleClipboard();
                  },
                  "aria-label": "Sync clipboard",
                  className: "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition hover:opacity-80",
                  style: { color: "var(--text-muted)" },
                  title: "Sync clipboard to room",
                  children: /* @__PURE__ */ jsx(Clipboard, { className: "h-5 w-5" })
                }
              ),
              mode === "code" ? /* @__PURE__ */ jsx(
                "textarea",
                {
                  value,
                  onChange: (e) => setValue(e.target.value),
                  placeholder: "Paste a code snippet...",
                  rows: 3,
                  className: "min-w-0 flex-1 resize-none bg-transparent px-1 py-2 font-mono text-sm outline-none sm:text-[13px]",
                  style: { color: "var(--text-primary)" }
                }
              ) : /* @__PURE__ */ jsx(
                "input",
                {
                  type: "text",
                  value,
                  onChange: (e) => setValue(e.target.value),
                  placeholder: "Share text, link, or drop files...",
                  className: "min-w-0 flex-1 bg-transparent px-1 py-2 text-sm outline-none sm:text-[15px]",
                  style: { color: "var(--text-primary)" }
                }
              ),
              /* @__PURE__ */ jsx(
                "button",
                {
                  type: "submit",
                  disabled: !value.trim(),
                  "aria-label": "Send",
                  className: "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-[#0b0e11] transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 active:scale-95",
                  children: /* @__PURE__ */ jsx(Send, { className: "h-4 w-4" })
                }
              )
            ]
          }
        )
      ]
    }
  );
}
export {
  MessageInput
};
