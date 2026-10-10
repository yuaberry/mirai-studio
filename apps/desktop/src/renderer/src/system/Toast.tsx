/**
 * Toasts — user-facing notifications (spec §44).
 */
import { useEffect } from 'react'
import { AlertTriangle, CheckCircle2, Info, RotateCcw, X, XCircle } from 'lucide-react'
import { cn } from '../lib/utils'
import { useAppStore, type Toast } from '../store/appStore'

const KIND_META: Record<Toast['kind'], { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: 'text-mirai-accent-3' },
  success: { icon: CheckCircle2, className: 'text-mirai-success' },
  warning: { icon: AlertTriangle, className: 'text-mirai-warn' },
  error: { icon: XCircle, className: 'text-mirai-danger' },
  recovered: { icon: RotateCcw, className: 'text-mirai-accent-2' },
}

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useAppStore((s) => s.dismissToast)
  const meta = KIND_META[toast.kind]
  const Icon = meta.icon

  useEffect(() => {
    const ttl = toast.kind === 'error' ? 8_000 : 5_000
    const timer = setTimeout(() => dismiss(toast.id), ttl)
    return () => clearTimeout(timer)
  }, [toast.id, toast.kind, dismiss])

  return (
    <div
      role="status"
      className="pointer-events-auto flex w-80 animate-in-up items-start gap-3 rounded-lg border border-mirai-border-strong bg-mirai-panel/95 px-4 py-3 shadow-xl shadow-black/40 backdrop-blur"
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', meta.className)} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-mirai-text">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-xs leading-relaxed text-mirai-dim">{toast.description}</p>
        )}
      </div>
      <button
        onClick={() => dismiss(toast.id)}
        className="text-mirai-faint transition-colors hover:text-mirai-text"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function Toaster() {
  const toasts = useAppStore((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed right-4 bottom-10 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  )
}
