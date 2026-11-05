/**
 * Configurable shortcuts (Phase 5) — the full system.
 *
 * Combos are normalized strings: lowercase, '+'-joined, modifiers first in
 * ctrl → alt → shift → meta order, then the key alias
 * (e.g. "ctrl+k", "space", "shift+delete", "arrowleft").
 * User overrides live in AppSettings.shortcuts; effective bindings are
 * DEFAULT_SHORTCUTS ⊕ overrides.
 */

export interface ShortcutAction {
  readonly id: string
  readonly label: string
  readonly group: 'Timeline' | 'Application'
  readonly defaultCombo: string
}

/** The catalog of every bindable action. */
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  // ---- Timeline ----------------------------------------------------------
  { id: 'timeline.togglePlay', label: 'Play / Pause', group: 'Timeline', defaultCombo: 'space' },
  { id: 'timeline.stop', label: 'Stop & return to start', group: 'Timeline', defaultCombo: 'escape' },
  { id: 'timeline.frameBack', label: 'Step back one frame', group: 'Timeline', defaultCombo: 'arrowleft' },
  { id: 'timeline.frameFwd', label: 'Step forward one frame', group: 'Timeline', defaultCombo: 'arrowright' },
  { id: 'timeline.split', label: 'Split clip at playhead', group: 'Timeline', defaultCombo: 's' },
  { id: 'timeline.delete', label: 'Delete selected clip', group: 'Timeline', defaultCombo: 'delete' },
  { id: 'timeline.rippleDelete', label: 'Ripple delete selected clip', group: 'Timeline', defaultCombo: 'shift+delete' },
  { id: 'timeline.marker', label: 'Add marker at playhead', group: 'Timeline', defaultCombo: 'm' },
  { id: 'timeline.keyframe', label: 'Add camera keyframe at playhead', group: 'Timeline', defaultCombo: 'k' },
  { id: 'timeline.zoomIn', label: 'Zoom in', group: 'Timeline', defaultCombo: 'equal' },
  { id: 'timeline.zoomOut', label: 'Zoom out', group: 'Timeline', defaultCombo: 'minus' },
  { id: 'timeline.zoomFit', label: 'Zoom to fit timeline', group: 'Timeline', defaultCombo: '0' },
  { id: 'timeline.snap', label: 'Toggle snapping', group: 'Timeline', defaultCombo: 'shift+s' },
  { id: 'timeline.undo', label: 'Undo timeline edit', group: 'Timeline', defaultCombo: 'ctrl+z' },
  { id: 'timeline.redo', label: 'Redo timeline edit', group: 'Timeline', defaultCombo: 'ctrl+shift+z' },
  { id: 'timeline.prevMarker', label: 'Jump to previous marker', group: 'Timeline', defaultCombo: 'comma' },
  { id: 'timeline.nextMarker', label: 'Jump to next marker', group: 'Timeline', defaultCombo: 'period' },
  // ---- Application -------------------------------------------------------
  { id: 'app.palette', label: 'Command palette', group: 'Application', defaultCombo: 'ctrl+k' },
]

/** actionId → default combo. */
export const DEFAULT_SHORTCUTS: Readonly<Record<string, string>> = Object.fromEntries(
  SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultCombo]),
)

/** Merge defaults with user overrides (overrides win; unknown ids ignored). */
export function effectiveShortcuts(overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_SHORTCUTS }
  for (const action of SHORTCUT_ACTIONS) {
    const combo = overrides[action.id]
    if (typeof combo === 'string' && combo.length > 0) out[action.id] = combo
  }
  return out
}

// ---------------------------------------------------------------- normalize

const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  '=': 'equal',
  '+': 'equal',
  '-': 'minus',
  '_': 'minus',
  delete: 'delete',
  backspace: 'delete',
  escape: 'escape',
  esc: 'escape',
  arrowleft: 'arrowleft',
  left: 'arrowleft',
  arrowright: 'arrowright',
  right: 'arrowright',
  arrowup: 'arrowup',
  arrowdown: 'arrowdown',
  enter: 'enter',
  tab: 'tab',
}

/**
 * Normalize raw combo parts into canonical form.
 * Accepts human input like "Ctrl + K", "SPACE", "Shift+Del".
 */
export function normalizeCombo(raw: string): string {
  const parts = raw
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0)
  if (parts.length === 0) return ''
  const key = KEY_ALIASES[parts[parts.length - 1]!] ?? parts[parts.length - 1]!
  const mods = new Set(parts.slice(0, -1).map((p) => (p === 'cmd' || p === 'cmdorctrl' || p === 'command' ? 'ctrl' : p)))
  const ordered = ['ctrl', 'alt', 'shift', 'meta'].filter((m) => mods.has(m))
  return [...ordered, key].join('+')
}

/** Validate a user-supplied combo string (after normalization). */
export function isValidCombo(combo: string): boolean {
  if (combo.length === 0 || combo.length > 40) return false
  return /^[a-z0-9]+(\+[a-z0-9]+)*$/.test(combo)
}

// ---------------------------------------------------------------- display

const PRETTY_KEYS: Record<string, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  meta: '⌘',
  space: 'Space',
  escape: 'Esc',
  delete: 'Del',
  enter: 'Enter',
  tab: 'Tab',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  equal: '+',
  minus: '−',
  comma: ',',
  period: '.',
}

/** Render a combo for humans: "ctrl+shift+s" → "Ctrl+Shift+S". */
export function prettyCombo(combo: string): string {
  const parts = combo.split('+')
  return parts
    .map((p) => PRETTY_KEYS[p] ?? (p.length === 1 ? p.toUpperCase() : p))
    .join('+')
}

/** Find actions bound to a combo (conflict detection for the rebind UI). */
export function actionsBoundTo(combo: string, effective: Readonly<Record<string, string>>): string[] {
  return SHORTCUT_ACTIONS.filter((a) => effective[a.id] === combo).map((a) => a.id)
}
