import { useEffect, useRef } from 'react'
import { Download, FileImage, FileText } from 'lucide-react'
import type { ActivityItem } from '../../types'
import { formatFileSize, isImageMime } from '../../utils/formatFileSize'
import { formatTime } from '../../utils/formatTime'

interface ActivityFeedProps {
  activities: ActivityItem[]
  selfParticipantId?: string | null
}

function actorLabel(item: ActivityItem, selfParticipantId?: string | null): string {
  if (selfParticipantId && item.senderId === selfParticipantId) return 'You'
  if (item.sender && item.sender !== 'You') return item.sender
  return 'Host'
}

function formatMeetingContent(item: ActivityItem, selfParticipantId?: string | null): string {
  let action = item.content.trim()
  if (action.startsWith('You ')) {
    action = action.slice(4)
  }

  if (!item.senderId && !item.sender) {
    return item.content
  }

  return `${actorLabel(item, selfParticipantId)} ${action}`
}

function FileRow({ item }: { item: ActivityItem }) {
  const meta = item.fileMeta
  if (!meta) return null

  const canDownload = Boolean(meta.objectUrl || meta.downloadUrl)
  const href = meta.objectUrl ?? meta.downloadUrl
  const progress = meta.progress ?? (meta.status === 'complete' ? 1 : 0)
  const pathLabel =
    meta.transferPath === 'storage'
      ? 'via relay'
      : meta.transferPath === 'relay'
        ? 'via TURN'
        : meta.transferPath === 'direct'
          ? 'via direct connection'
          : null

  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-accent">{item.sender} · file</span>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {formatTime(item.timestamp)}
        </span>
      </div>

      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'rgba(79, 209, 197, 0.12)' }}
        >
          {isImageMime(meta.mimeType) ? (
            <FileImage className="h-5 w-5 text-accent" />
          ) : (
            <FileText className="h-5 w-5 text-accent" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {meta.fileName}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {formatFileSize(meta.fileSize)}
            {pathLabel ? ` · ${pathLabel}` : ''}
            {meta.status === 'failed' ? ' · transfer failed' : ''}
            {meta.status === 'transferring' ? ` · ${Math.round(progress * 100)}%` : ''}
          </p>

          {meta.status === 'transferring' && (
            <div
              className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--border)' }}
            >
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }}
              />
            </div>
          )}

          {canDownload && href && isImageMime(meta.mimeType) && (
            <img
              src={href}
              alt={meta.fileName}
              className="mt-2 max-h-40 rounded-lg border object-contain"
              style={{ borderColor: 'var(--border)' }}
            />
          )}

          {canDownload && href && (
            <a
              href={href}
              download={meta.fileName}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function ActivityRow({
  item,
  selfParticipantId,
}: {
  item: ActivityItem
  selfParticipantId?: string | null
}) {
  if (item.type === 'system') {
    return (
      <div className="py-2 text-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {item.content}
        </p>
      </div>
    )
  }

  if (item.type === 'meeting') {
    return (
      <div className="py-2 text-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {formatMeetingContent(item, selfParticipantId)}
        </p>
      </div>
    )
  }

  if (item.type === 'file') {
    return <FileRow item={item} />
  }

  if (item.type === 'clipboard') {
    return (
      <div
        className="rounded-xl border px-4 py-3"
        style={{
          background: 'var(--bg-elevated)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-accent">{item.sender} · clipboard</span>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {formatTime(item.timestamp)}
          </span>
        </div>
        <p className="line-clamp-3 break-all text-sm" style={{ color: 'var(--text-primary)' }}>
          {item.content}
        </p>
      </div>
    )
  }

  if (item.type === 'code') {
    return (
      <div
        className="rounded-xl border px-4 py-3"
        style={{
          background: 'var(--bg-elevated)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-accent">{item.sender} · code</span>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {formatTime(item.timestamp)}
          </span>
        </div>
        <pre
          className="overflow-x-auto rounded-lg p-3 font-mono text-xs leading-relaxed sm:text-sm"
          style={{
            background: 'rgba(0,0,0,0.25)',
            color: 'var(--text-primary)',
          }}
        >
          {item.content}
        </pre>
      </div>
    )
  }

  const isLink = item.type === 'link'

  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-accent">{item.sender}</span>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {formatTime(item.timestamp)}
        </span>
      </div>
      {isLink ? (
        <a
          href={item.content}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-sm text-accent underline-offset-2 hover:underline"
        >
          {item.content}
        </a>
      ) : (
        <p className="break-words text-sm" style={{ color: 'var(--text-primary)' }}>
          {item.content}
        </p>
      )}
    </div>
  )
}

export function ActivityFeed({ activities, selfParticipantId }: ActivityFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activities.length])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p
        className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em]"
        style={{ color: 'var(--text-muted)' }}
      >
        Activity
      </p>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {activities.length === 0 ? (
          <div className="flex h-full min-h-[160px] items-center justify-center">
            <p className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Share text, links, files, clipboard, or code while you collaborate.
            </p>
          </div>
        ) : (
          activities.map((item) => (
            <ActivityRow key={item.id} item={item} selfParticipantId={selfParticipantId} />
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
