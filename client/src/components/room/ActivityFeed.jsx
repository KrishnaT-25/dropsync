import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { Download, FileImage, FileText } from "lucide-react";
import { formatFileSize, isImageMime } from "../../utils/formatFileSize";
import { formatTime } from "../../utils/formatTime";
function actorLabel(item, selfParticipantId) {
  if (selfParticipantId && item.senderId === selfParticipantId) return "You";
  if (item.sender && item.sender !== "You") return item.sender;
  return "Host";
}
function formatMeetingContent(item, selfParticipantId) {
  let action = item.content.trim();
  if (action.startsWith("You ")) {
    action = action.slice(4);
  }
  if (!item.senderId && !item.sender) {
    return item.content;
  }
  return `${actorLabel(item, selfParticipantId)} ${action}`;
}
function FileRow({
  item,
  selfParticipantId,
  onDownload
}) {
  const meta = item.fileMeta;
  if (!meta) return null;
  const canDownload = Boolean(meta.objectUrl || meta.downloadUrl);
  const href = meta.objectUrl ?? meta.downloadUrl;
  const progress = meta.progress ?? (meta.status === "complete" ? 1 : 0);
  const pathLabel = meta.transferPath === "storage" ? "private storage" : meta.transferPath === "relay" ? "via TURN" : meta.transferPath === "direct" ? "via direct connection" : null;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "rounded-xl border px-4 py-3",
      style: {
        background: "var(--bg-elevated)",
        borderColor: "var(--border)"
      },
      children: [
        /* @__PURE__ */ jsxs("div", { className: "mb-2 flex items-center justify-between gap-2", children: [
          /* @__PURE__ */ jsxs("span", { className: "text-xs font-medium text-accent", children: [
            actorLabel(item, selfParticipantId),
            " \xB7 file"
          ] }),
          /* @__PURE__ */ jsx("span", { className: "text-[11px]", style: { color: "var(--text-muted)" }, children: formatTime(item.timestamp) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-start gap-3", children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              className: "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              style: { background: "rgba(79, 209, 197, 0.12)" },
              children: isImageMime(meta.mimeType) ? /* @__PURE__ */ jsx(FileImage, { className: "h-5 w-5 text-accent" }) : /* @__PURE__ */ jsx(FileText, { className: "h-5 w-5 text-accent" })
            }
          ),
          /* @__PURE__ */ jsxs("div", { className: "min-w-0 flex-1", children: [
            /* @__PURE__ */ jsx("p", { className: "truncate text-sm font-medium", style: { color: "var(--text-primary)" }, children: meta.fileName }),
            /* @__PURE__ */ jsxs("p", { className: "text-xs", style: { color: "var(--text-muted)" }, children: [
              formatFileSize(meta.fileSize),
              pathLabel ? ` \xB7 ${pathLabel}` : "",
              meta.status === "failed" ? " \xB7 transfer failed" : "",
              meta.status === "transferring" ? ` \xB7 ${Math.round(progress * 100)}%` : ""
            ] }),
            meta.status === "transferring" && /* @__PURE__ */ jsx(
              "div",
              {
                className: "mt-2 h-1.5 w-full overflow-hidden rounded-full",
                style: { background: "var(--border)" },
                children: /* @__PURE__ */ jsx(
                  "div",
                  {
                    className: "h-full rounded-full bg-accent transition-all",
                    style: { width: `${Math.max(4, Math.round(progress * 100))}%` }
                  }
                )
              }
            ),
            canDownload && href && isImageMime(meta.mimeType) && /* @__PURE__ */ jsx(
              "img",
              {
                src: href,
                alt: meta.fileName,
                className: "mt-2 max-h-40 rounded-lg border object-contain",
                style: { borderColor: "var(--border)" }
              }
            ),
            meta.transferId && /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => void onDownload?.(meta.transferId), className: "mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline", children: [/* @__PURE__ */ jsx(Download, { className: "h-3.5 w-3.5" }), "Download"] }),
            !meta.transferId && canDownload && href && /* @__PURE__ */ jsxs(
              "a",
              {
                href,
                download: meta.fileName,
                className: "mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline",
                children: [
                  /* @__PURE__ */ jsx(Download, { className: "h-3.5 w-3.5" }),
                  "Download"
                ]
              }
            )
          ] })
        ] })
      ]
    }
  );
}
function ActivityRow({
  item,
  selfParticipantId,
  onDownload
}) {
  if (item.type === "system") {
    return /* @__PURE__ */ jsx("div", { className: "py-2 text-center", children: /* @__PURE__ */ jsx("p", { className: "text-sm", style: { color: "var(--text-muted)" }, children: item.content }) });
  }
  if (item.type === "meeting") {
    return /* @__PURE__ */ jsx("div", { className: "py-2 text-center", children: /* @__PURE__ */ jsx("p", { className: "text-sm", style: { color: "var(--text-muted)" }, children: formatMeetingContent(item, selfParticipantId) }) });
  }
  if (item.type === "file") {
    return /* @__PURE__ */ jsx(FileRow, { item, selfParticipantId, onDownload });
  }
  if (item.type === "clipboard") {
    return /* @__PURE__ */ jsxs(
      "div",
      {
        className: "rounded-xl border px-4 py-3",
        style: {
          background: "var(--bg-elevated)",
          borderColor: "var(--border)"
        },
        children: [
          /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-center justify-between gap-2", children: [
            /* @__PURE__ */ jsxs("span", { className: "text-xs font-medium text-accent", children: [
              item.sender,
              " \xB7 clipboard"
            ] }),
            /* @__PURE__ */ jsx("span", { className: "text-[11px]", style: { color: "var(--text-muted)" }, children: formatTime(item.timestamp) })
          ] }),
          /* @__PURE__ */ jsx("p", { className: "line-clamp-3 break-all text-sm", style: { color: "var(--text-primary)" }, children: item.content })
        ]
      }
    );
  }
  if (item.type === "code") {
    return /* @__PURE__ */ jsxs(
      "div",
      {
        className: "rounded-xl border px-4 py-3",
        style: {
          background: "var(--bg-elevated)",
          borderColor: "var(--border)"
        },
        children: [
          /* @__PURE__ */ jsxs("div", { className: "mb-2 flex items-center justify-between gap-2", children: [
            /* @__PURE__ */ jsxs("span", { className: "text-xs font-medium text-accent", children: [
              item.sender,
              " \xB7 code"
            ] }),
            /* @__PURE__ */ jsx("span", { className: "text-[11px]", style: { color: "var(--text-muted)" }, children: formatTime(item.timestamp) })
          ] }),
          /* @__PURE__ */ jsx(
            "pre",
            {
              className: "overflow-x-auto rounded-lg p-3 font-mono text-xs leading-relaxed sm:text-sm",
              style: {
                background: "rgba(0,0,0,0.25)",
                color: "var(--text-primary)"
              },
              children: item.content
            }
          )
        ]
      }
    );
  }
  const isLink = item.type === "link";
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "rounded-xl border px-4 py-3",
      style: {
        background: "var(--bg-elevated)",
        borderColor: "var(--border)"
      },
      children: [
        /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-center justify-between gap-2", children: [
          /* @__PURE__ */ jsx("span", { className: "text-xs font-medium text-accent", children: item.sender }),
          /* @__PURE__ */ jsx("span", { className: "text-[11px]", style: { color: "var(--text-muted)" }, children: formatTime(item.timestamp) })
        ] }),
        isLink ? /* @__PURE__ */ jsx(
          "a",
          {
            href: item.content,
            target: "_blank",
            rel: "noopener noreferrer",
            className: "break-all text-sm text-accent underline-offset-2 hover:underline",
            children: item.content
          }
        ) : /* @__PURE__ */ jsx("p", { className: "break-words text-sm", style: { color: "var(--text-primary)" }, children: item.content })
      ]
    }
  );
}
function ActivityFeed({ activities, selfParticipantId, onDownload, title = "Activity" }) {
  const bottomRef = useRef(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activities.length]);
  return /* @__PURE__ */ jsxs("div", { className: "flex min-h-0 flex-1 flex-col", children: [
    /* @__PURE__ */ jsx(
      "p",
      {
        className: "mb-4 text-[11px] font-semibold uppercase tracking-[0.2em]",
        style: { color: "var(--text-muted)" },
        children: title
      }
    ),
    /* @__PURE__ */ jsxs("div", { className: "min-h-0 flex-1 space-y-3 overflow-y-auto pr-1", children: [
      activities.length === 0 ? /* @__PURE__ */ jsx("div", { className: "flex h-full min-h-[160px] items-center justify-center", children: /* @__PURE__ */ jsx("p", { className: "text-center text-sm", style: { color: "var(--text-muted)" }, children: "Share text, links, files, clipboard, or code while you collaborate." }) }) : activities.map((item) => /* @__PURE__ */ jsx(ActivityRow, { item, selfParticipantId, onDownload }, item.id)),
      /* @__PURE__ */ jsx("div", { ref: bottomRef })
    ] })
  ] });
}
export {
  ActivityFeed
};
