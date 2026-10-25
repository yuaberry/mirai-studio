/**
 * Mirai design system primitives. Dark-first, dense, accessible.
 */
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '../lib/utils'

// -------------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-mirai-accent text-[#0a0c10] font-semibold hover:brightness-110 active:brightness-95 border border-transparent',
  outline:
    'border border-mirai-border-strong bg-mirai-raise text-mirai-text hover:bg-mirai-hover active:bg-mirai-panel',
  ghost: 'text-mirai-dim hover:text-mirai-text hover:bg-mirai-hover border border-transparent',
  danger: 'border border-transparent bg-mirai-danger/15 text-mirai-danger hover:bg-mirai-danger/25',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-10 px-5 text-sm gap-2',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'md', loading = false, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-[filter,background-color,color,border-color] duration-100',
        'disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="h-3.5 w-3.5" /> : null}
      {children}
    </button>
  )
})

// ---------------------------------------------------------------- IconButton

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  active?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-mirai-dim transition-colors',
        'hover:bg-mirai-hover hover:text-mirai-text',
        active && 'bg-mirai-hover text-mirai-text',
        'disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
})

// --------------------------------------------------------------------- Input

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-9 w-full rounded-md border border-mirai-border bg-mirai-panel px-3 text-sm text-mirai-text',
          'placeholder:text-mirai-faint',
          'transition-colors focus:border-mirai-accent/60 focus:outline-none',
          'disabled:opacity-50',
          className,
        )}
        {...props}
      />
    )
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full resize-none rounded-md border border-mirai-border bg-mirai-panel px-3 py-2 text-sm text-mirai-text',
          'placeholder:text-mirai-faint',
          'focus:border-mirai-accent/60 focus:outline-none',
          className,
        )}
        {...props}
      />
    )
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'h-9 w-full appearance-none rounded-md border border-mirai-border bg-mirai-panel px-3 pr-8 text-sm text-mirai-text',
          'focus:border-mirai-accent/60 focus:outline-none',
          'bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239aa3b5%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")] bg-[position:right_8px_center] bg-no-repeat',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    )
  },
)

export function Label({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('mb-1.5 block text-xs font-medium text-mirai-dim', className)} {...props}>
      {children}
    </label>
  )
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="mt-1 text-xs text-mirai-danger">{message}</p>
}

// ---------------------------------------------------------------------- Card

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('panel', className)} {...props}>
      {children}
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-display text-[11px] font-semibold tracking-[0.14em] text-mirai-dim uppercase">
        {children}
      </h2>
      {right}
    </div>
  )
}

// --------------------------------------------------------------------- Badge

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info' | 'violet'

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-mirai-hover text-mirai-dim border-mirai-border-strong',
  accent: 'bg-mirai-accent/10 text-mirai-accent border-mirai-accent/25',
  success: 'bg-mirai-success/10 text-mirai-success border-mirai-success/25',
  warn: 'bg-mirai-warn/10 text-mirai-warn border-mirai-warn/25',
  danger: 'bg-mirai-danger/10 text-mirai-danger border-mirai-danger/25',
  info: 'bg-mirai-accent-3/10 text-mirai-accent-3 border-mirai-accent-3/25',
  violet: 'bg-mirai-accent-2/10 text-mirai-accent-2 border-mirai-accent-2/25',
}

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide',
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

// ------------------------------------------------------------------- Spinner

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-4 w-4 animate-[mirai-spin_0.8s_linear_infinite] text-mirai-dim', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Loading"
      role="status"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

// ------------------------------------------------------------------------ Kbd

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-mirai-border-strong bg-mirai-panel px-1.5 py-0.5 font-sans text-[10px] font-semibold text-mirai-dim">
      {children}
    </kbd>
  )
}

// ---------------------------------------------------------------------- Tabs

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>
  active: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1 border-b border-mirai-border', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'relative -mb-px border-b-2 border-transparent px-3 py-2 text-xs font-semibold transition-colors',
            tab.id === active
              ? 'border-mirai-accent text-mirai-text'
              : 'text-mirai-dim hover:text-mirai-text',
          )}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <span className="ml-1.5 rounded-full bg-mirai-hover px-1.5 text-[10px] text-mirai-dim">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
