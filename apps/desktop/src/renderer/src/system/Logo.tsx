/**
 * Mirai Studio logo — a four-point star (future/crystal) with the brand gradient.
 */
import { cn } from '../lib/utils'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('h-6 w-6', className)} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="mirai-mark" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0" stopColor="#f472b6" />
          <stop offset="0.5" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path
        d="M16 1.5 20.2 11.8 30.5 16 20.2 20.2 16 30.5 11.8 20.2 1.5 16 11.8 11.8Z"
        fill="url(#mirai-mark)"
      />
      <path
        d="M16 8.5 18 14l5.5 2-5.5 2-2 5.5-2-5.5L8.5 16 14 14Z"
        fill="#0a0c10"
        fillOpacity="0.55"
      />
    </svg>
  )
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      {!compact && (
        <div className="leading-none">
          <span className="font-display text-[15px] font-bold tracking-[0.18em] text-mirai-text">
            MIRAI
          </span>
          <span className="ml-1.5 font-display text-[15px] font-bold tracking-[0.18em] text-gradient-mirai">
            STUDIO
          </span>
          <p className="mt-1 hidden text-[9px] font-medium tracking-[0.22em] text-mirai-faint uppercase">
            From imagination to animation
          </p>
        </div>
      )}
    </div>
  )
}
