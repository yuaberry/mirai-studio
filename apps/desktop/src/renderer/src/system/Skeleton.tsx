/**
 * Skeleton (v0.26) — loading placeholders with the same shape as the real
 * content, so lists don't jump when data lands. Pulse animation is pure
 * Tailwind (animate-pulse) — no JS timers.
 */
import { cn } from '../lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-mirai-hover', className)} />
}

/** A text line placeholder of a given relative width (default 70%). */
export function SkeletonText({ lines = 1, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        // last line shorter — reads like a real paragraph tail
        <Skeleton key={i} className={cn('h-3 rounded', i === lines - 1 && lines > 1 ? 'w-1/2' : 'w-full')} />
      ))}
    </div>
  )
}

/** Card-shaped placeholder for grid layouts (hub, episode lists…). */
export function SkeletonCard() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-mirai-border bg-mirai-panel/60 p-4">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-3 w-1/3" />
      <div className="mt-1 flex gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>
    </div>
  )
}

/** Row-shaped placeholder for side lists (episodes, pages…). */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2">
      <Skeleton className="h-7 w-7 rounded-md" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-3/4 rounded" />
        <Skeleton className="h-2.5 w-1/2 rounded" />
      </div>
    </div>
  )
}

/** Full-list placeholder: N rows (default tuned per usage site). */
export function SkeletonList({ rows = 6, kind = 'row' }: { rows?: number; kind?: 'row' | 'card' }) {
  return (
    <div className={kind === 'card' ? 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3' : 'space-y-0.5'}>
      {Array.from({ length: rows }).map((_, i) =>
        kind === 'card' ? <SkeletonCard key={i} /> : <SkeletonRow key={i} />,
      )}
    </div>
  )
}
