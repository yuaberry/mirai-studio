/**
 * Modal — portal-based, ESC/overlay close, initial focus on the dialog.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button, IconButton } from './ui'

/**
 * Modal — portal-based, ESC/overlay close, initial focus on the dialog.
 *
 * FOCUS CONTRACT (v0.15.1): the dialog takes focus ONCE, when it opens.
 * The ESC handler may depend on onClose (fresh identity per parent render
 * is normal), but re-running focus on every re-render STEALS focus from
 * the inputs — typing died after one keystroke until this was split.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  width?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Initial focus — ONLY on the closed→open transition, never per re-render.
  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-10 flex max-h-[calc(100vh-3rem)] w-full animate-scale-in flex-col rounded-xl border border-mirai-border-strong bg-mirai-raise shadow-2xl shadow-black/50 outline-none',
          width,
        )}
      >
        <div className="flex flex-none items-start justify-between gap-4 border-b border-mirai-border px-5 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-mirai-text">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-mirai-dim">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-none items-center justify-end gap-2 border-t border-mirai-border px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Destructive-action confirmation built on Modal (spec §21). */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description: string
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-mirai-dim">{description}</p>
    </Modal>
  )
}
