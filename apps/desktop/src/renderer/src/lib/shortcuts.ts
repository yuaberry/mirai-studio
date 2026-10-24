/**
 * Configurable shortcut executor (Phase 5).
 *
 * The catalog + defaults + normalization live in @mirai/shared. This module:
 *   1. converts KeyboardEvents to normalized combos,
 *   2. runs a single global keydown listener matched against the EFFECTIVE
 *      bindings (defaults ⊕ user overrides from AppSettings),
 *   3. dispatches to handlers registered per action id (usually by the
 *      active page — the TimelinePage registers its actions on mount).
 */
import { useEffect } from 'react'
import {
  effectiveShortcuts,
  normalizeCombo,
  type ShortcutAction,
} from '@mirai/shared'
import type { AppSettings } from '@mirai/shared'

// ---------------------------------------------------------------- event → combo

const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  '=': 'equal',
  '+': 'equal',
  '-': 'minus',
  _: 'minus',
  Escape: 'escape',
  Esc: 'escape',
  Delete: 'delete',
  Backspace: 'delete',
  ArrowLeft: 'arrowleft',
  ArrowRight: 'arrowright',
  ArrowUp: 'arrowup',
  ArrowDown: 'arrowdown',
  Enter: 'enter',
}

/** Convert a KeyboardEvent into the canonical combo string ("ctrl+shift+s"). */
export function comboFromEvent(e: KeyboardEvent): string {
  const key = e.key
  const base = KEY_ALIASES[key] ?? (key.length === 1 ? key.toLowerCase() : key.toLowerCase())
  const mods: string[] = []
  if (e.ctrlKey || e.metaKey) mods.push('ctrl')
  if (e.altKey) mods.push('alt')
  if (e.shiftKey) mods.push('shift')
  return normalizeCombo([...mods, base].join('+'))
}

// ---------------------------------------------------------------- registry

type Handler = (e: KeyboardEvent) => void
const handlers = new Map<string, Handler>()

/** Register the handler for an action id — returns a cleanup function. */
export function registerShortcutHandler(actionId: string, handler: Handler): () => void {
  handlers.set(actionId, handler)
  return () => {
    // Only delete if nobody else re-registered meanwhile.
    if (handlers.get(actionId) === handler) handlers.delete(actionId)
  }
}

// ---------------------------------------------------------------- listener

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  const tag = t.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    t.isContentEditable
  )
}

/**
 * The global listener hook. Mount ONCE (AppShell). Reads the effective
 * bindings from settings and dispatches to registered handlers, skipping
 * events aimed at text inputs (typing "s" in a label must not split clips).
 */
export function useShortcutDispatcher(settings: AppSettings | undefined): void {
  useEffect(() => {
    if (!settings) return
    const effective = effectiveShortcuts(settings.shortcuts)
    // combo → actionId (first match wins; the rebind UI warns about duplicates)
    const byCombo = new Map<string, string>()
    for (const [actionId, combo] of Object.entries(effective)) {
      if (!byCombo.has(combo)) byCombo.set(combo, actionId)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      // Typing in a text field must never trigger actions.
      if (isEditableTarget(e.target)) return
      const combo = comboFromEvent(e)
      const actionId = byCombo.get(combo)
      if (!actionId) return
      const handler = handlers.get(actionId)
      if (!handler) return
      // Only swallow the event when a registered action actually handles it.
      e.preventDefault()
      handler(e)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settings])
}

export type { ShortcutAction }
