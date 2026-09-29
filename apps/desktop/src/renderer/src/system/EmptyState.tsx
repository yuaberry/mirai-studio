/**
 * EmptyState / ErrorState — real empty and error states everywhere
 * (spec §10, §26): icon, human message, primary action. Never silent.
 */
import type { ReactNode } from 'react'
import { cn } from '../lib/utils'
import { Button } from './ui'

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex h-full min-h-48 flex-col items-center justify-center gap-3 p-8 text-center',
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-mirai-border bg-mirai-panel text-mirai-faint">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-mirai-text">{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-mirai-dim">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  )
}

export function ErrorState({
  title,
  message,
  onRetry,
  extra,
}: {
  title: string
  message: string
  onRetry?: () => void
  extra?: ReactNode
}) {
  return (
    <EmptyState
      icon={<span className="text-lg text-mirai-danger">✕</span>}
      title={title}
      description={message}
      action={
        <div className="flex items-center gap-2">
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          )}
          {extra}
        </div>
      }
    />
  )
}
