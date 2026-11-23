/**
 * Motion (v2.1) — how the interface moves, and how to switch it off.
 *
 * WHY A MODULE INSTEAD OF CSS CONSTANTS
 * -------------------------------------
 * The user asked for something beautiful with a switch that goes from "full
 * animation" to "instantly no animation" — including for people who need it
 * (vestibular sensitivity) and for people whose machine is slow. That means
 * every duration and delay in the UI has to be DERIVED from a setting, not
 * sprinkled as magic numbers across components.
 *
 * This module is that single source of truth. It is PURE (it takes a setting
 * and returns CSS values), so it is unit-tested without mounting React.
 *
 * HOW IT LANDS IN THE UI
 * ----------------------
 * `applyMotion(element, settings)` writes three things:
 *   · `data-motion="on|off"`      → CSS kills every transition/animation
 *   · `--motion-ms`               → the base duration every rule multiplies
 *   · `--motion-ease`             → the curve, matched to the speed
 *
 * A component then only needs `transition: transform var(--motion-ms) var(--motion-ease)`
 * and it obeys the setting automatically.
 */

/** The user's choice of how alive the interface feels. */
export type MotionSpeed = 'off' | 'calm' | 'normal' | 'swift' | 'instant'
/** How much decorative detail the UI carries. */
export type DetailLevel = 'minimal' | 'balanced' | 'rich'
/** The page transition style. */
export type TransitionStyle = 'fade' | 'rise' | 'scale' | 'slide' | 'none'

export interface MotionSettings {
  /** Master switch: false means the interface never animates. */
  enabled: boolean
  speed: MotionSpeed
  detail: DetailLevel
  transition: TransitionStyle
  /** Respect the OS "reduce motion" preference (default on, cannot be lied to). */
  respectSystemPreference: boolean
}

/**
 * Duration of a base transition, in milliseconds.
 *
 * `off` and `instant` are both ZERO — the difference is only that `off` also
 * removes the decorative motion entirely, which the UI reads through
 * `data-motion="off"`.
 */
export const MOTION_MS: Record<MotionSpeed, number> = {
  off: 0,
  calm: 420,
  normal: 240,
  swift: 140,
  instant: 0,
}

/** The easing curve that suits each speed. */
export const MOTION_EASE: Record<MotionSpeed, string> = {
  off: 'linear',
  calm: 'cubic-bezier(0.22, 1, 0.36, 1)',
  normal: 'cubic-bezier(0.4, 0, 0.2, 1)',
  swift: 'cubic-bezier(0.4, 0, 0.2, 1)',
  instant: 'linear',
}

/** The entrance animation for a page change. */
export const MOTION_KEYFRAMES: Record<TransitionStyle, string> = {
  none: 'none',
  fade: 'mirai-fade-in var(--motion-ms) var(--motion-ease) both',
  rise: 'mirai-rise-in var(--motion-ms) var(--motion-ease) both',
  scale: 'mirai-scale-in var(--motion-ms) var(--motion-ease) both',
  slide: 'mirai-slide-in var(--motion-ms) var(--motion-ease) both',
}

/** A human label for the settings UI. */
export const MOTION_LABELS: Record<MotionSpeed, string> = {
  off: 'Off (no animation)',
  calm: 'Calm — slow and smooth',
  normal: 'Normal — balanced',
  swift: 'Swift — snappy',
  instant: 'Instant — no wait',
}

export const DETAIL_LABELS: Record<DetailLevel, string> = {
  minimal: 'Minimal — clean, fewer decorations',
  balanced: 'Balanced',
  rich: 'Rich — full detail',
}

export const TRANSITION_LABELS: Record<TransitionStyle, string> = {
  none: 'None',
  fade: 'Fade',
  rise: 'Rise',
  scale: 'Scale',
  slide: 'Slide',
}

export const DEFAULT_MOTION: MotionSettings = {
  enabled: true,
  speed: 'normal',
  detail: 'balanced',
  transition: 'rise',
  respectSystemPreference: true,
}

/** True when the OS asks for reduced motion (browser only). */
export function systemPrefersReducedMotion(): boolean {
  // The shared package is Electron-free by design, so `window` is reached
  // through globalThis and guarded — a missing matchMedia is a NO, not a crash.
  const root = globalThis as { matchMedia?: (q: string) => { matches: boolean } }
  if (typeof root.matchMedia !== 'function') return false
  try {
    return root.matchMedia('(prefers-reduced-motion: reduce)').matches === true
  } catch {
    return false
  }
}

/**
 * Resolves the settings into what the DOM should actually carry.
 *
 * The OS preference WINS over the app setting when enabled: an operating
 * system that says "less motion" is not something an app may override. That is
 * why `respectSystemPreference` defaults to true.
 */
export function resolveMotion(settings: MotionSettings, systemReducedMotion = false): {
  active: boolean
  ms: number
  ease: string
  keyframes: string
  detail: DetailLevel
  dataMotion: 'on' | 'off'
} {
  const systemOff = settings.respectSystemPreference && systemReducedMotion
  const active = settings.enabled && !systemOff
  const ms = active ? MOTION_MS[settings.speed] : 0
  return {
    active,
    ms,
    ease: active ? MOTION_EASE[settings.speed] : 'linear',
    keyframes: active ? MOTION_KEYFRAMES[settings.transition] : 'none',
    detail: settings.detail,
    dataMotion: active ? 'on' : 'off',
  }
}

/**
 * The CSS custom properties + data attribute, ready for a style attribute or
 * an element's dataset.
 */
export function motionStyleVars(resolved: ReturnType<typeof resolveMotion>): Record<string, string> {
  return {
    '--motion-ms': `${resolved.ms}ms`,
    '--motion-ease': resolved.ease,
  }
}

/** A one-line description for the status bar / toast. */
export function describeMotion(settings: MotionSettings, systemReducedMotion = false): string {
  const r = resolveMotion(settings, systemReducedMotion)
  if (!r.active) return systemReducedMotion && settings.respectSystemPreference
    ? 'Motion off (your system prefers reduced motion)'
    : `Motion off · ${MOTION_LABELS[settings.speed]} selected`
  return `Motion ${MOTION_LABELS[settings.speed]} · ${r.ms}ms · ${settings.transition} transition · ${settings.detail} detail`
}