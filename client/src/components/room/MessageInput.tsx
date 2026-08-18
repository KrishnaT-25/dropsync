import { Clipboard, Code2, Paperclip, Send } from 'lucide-react'
import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'

type InputMode = 'text' | 'code'

interface MessageInputProps {
  onSend: (content: string) => void
  onSendClipboard: (content: string) => void
  onSendCode: (content: string) => void
  onSendFile: (file: File) => void
  rateLimitHint?: string | null
}

export function MessageInput({
  onSend,
  onSendClipboard,
  onSendCode,
  onSendFile,
  rateLimitHint,
}: MessageInputProps) {
  const [value, setValue] = useState('')
  const [mode, setMode] = useState<InputMode>('text')
  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return

    if (mode === 'code') {
      onSendCode(trimmed)
    } else {
      onSend(trimmed)
    }
    setValue('')
  }

  const handleClipboard = async () => {
    setClipboardStatus(null)
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        setClipboardStatus('Clipboard is empty')
        return
      }
      onSendClipboard(text.trim())
      setClipboardStatus('Clipboard synced')
      window.setTimeout(() => setClipboardStatus(null), 2000)
    } catch {
      setClipboardStatus('Clipboard access denied')
    }
  }

  const handleFiles = (files: FileList | File[]) => {
    Array.from(files).forEach((file) => onSendFile(file))
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      handleFiles(e.target.files)
      e.target.value = ''
    }
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    setDragActive(true)
  }

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    setDragActive(false)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    if (e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files)
    }
  }

  return (
    <div
      className="mt-4"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragActive && (
        <div className="mb-2 rounded-xl border border-dashed border-accent bg-accent/10 px-4 py-3 text-center text-sm text-accent">
          Drop files to share
        </div>
      )}

      {rateLimitHint && (
        <p className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          {rateLimitHint}
        </p>
      )}

      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMode('text')}
          className="rounded-lg px-2.5 py-1 text-xs font-medium transition"
          style={{
            background: mode === 'text' ? 'rgba(79, 209, 197, 0.15)' : 'transparent',
            color: mode === 'text' ? 'var(--color-accent)' : 'var(--text-muted)',
          }}
        >
          Message
        </button>
        <button
          type="button"
          onClick={() => setMode('code')}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition"
          style={{
            background: mode === 'code' ? 'rgba(79, 209, 197, 0.15)' : 'transparent',
            color: mode === 'code' ? 'var(--color-accent)' : 'var(--text-muted)',
          }}
        >
          <Code2 className="h-3.5 w-3.5" />
          Code
        </button>
        {clipboardStatus && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {clipboardStatus}
          </span>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 rounded-2xl border p-2 sm:gap-3 sm:p-2.5"
        style={{
          background: 'var(--bg-elevated)',
          borderColor: 'var(--border)',
        }}
      >
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach file"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
          title="Attach files"
        >
          <Paperclip className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={() => {
            void handleClipboard()
          }}
          aria-label="Sync clipboard"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
          title="Sync clipboard to room"
        >
          <Clipboard className="h-5 w-5" />
        </button>

        {mode === 'code' ? (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste a code snippet..."
            rows={3}
            className="min-w-0 flex-1 resize-none bg-transparent px-1 py-2 font-mono text-sm outline-none sm:text-[13px]"
            style={{ color: 'var(--text-primary)' }}
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Share text, link, or drop files..."
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm outline-none sm:text-[15px]"
            style={{ color: 'var(--text-primary)' }}
          />
        )}

        <button
          type="submit"
          disabled={!value.trim()}
          aria-label="Send"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-[#0b0e11] transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 active:scale-95"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}