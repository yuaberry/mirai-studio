/**
 * MotionCard — how alive the interface feels (v2.1).
 *
 * The user asked for: beautiful transitions, a switch to speed them up or turn
 * them off, and a choice between minimal and rich detail. This card is that
 * switch, and it shows the RESOLVED value (the OS preference can override the
 * app one — the card says so instead of pretending the setting won).
 */
import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Zap } from 'lucide-react'
import {
  MOTION_LABELS,
  DETAIL_LABELS,
  TRANSITION_LABELS,
  MOTION_MS,
  DEFAULT_MOTION,
  resolveMotion,
  describeMotion,
  systemPrefersReducedMotion,
  type DetailLevel,
  type MotionSpeed,
  type TransitionStyle,
} from '@mirai/shared'
import { invoke } from '../../lib/ipc'
import { useT } from '../../lib/i18n'
import { Badge, Button, Label, Select } from '../../system/ui'

/** The shape the hooks below return. */
interface AppearanceMotion {
  enabled: boolean
  speed: MotionSpeed
  detail: DetailLevel
  transition: TransitionStyle
  respectSystemPreference: boolean
}

export function useAppearance() {
  const [motion, setMotion] = useState<AppearanceMotion | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const reload = async () => {
    try {
      const s = (await invoke('settings:get', {})) as unknown as { appearance: { motion: AppearanceMotion } }
      setMotion(s.appearance.motion)
    } catch {
      setMotion({ ...DEFAULT_MOTION })
    } finally {
      setIsLoading(false)
    }
  }

  return { motion, isLoading, reload, setMotion }
}

export function MotionCard() {
  const tr = useT()
  const { motion, reload } = useAppearance()
  const reduced = useMemo(() => systemPrefersReducedMotion(), [])

  // Load the settings on mount — without this the card renders NOTHING forever
  // (MEASURED: the Settings page showed the profile and general cards but no
  // motion card at all).
  useEffect(() => {
    void reload()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!motion) return null

  const resolved = resolveMotion(motion, reduced)
  const speedOptions: MotionSpeed[] = ['off', 'calm', 'normal', 'swift', 'instant']

  const save = async (patch: Partial<AppearanceMotion>) => {
    const next = { ...motion, ...patch }
    await invoke('settings:update', { settings: { appearance: { motion: next } } })
    // Re-read so the RESOLVED value (the OS preference can override) is what
    // the card shows.
    await reload()
  }

  return (
    <div className="space-y-3">
      {/* ---- the master switch, with the resolved truth ------------------ */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-mirai-accent" />
          <p className="text-xs font-semibold text-mirai-text">{tr('Interface motion')}</p>
          <Badge tone={resolved.active ? 'success' : 'neutral'}>
            {resolved.active ? `${tr('on')} · ${resolved.ms}ms` : tr('off')}
          </Badge>
        </div>
        <Button
          size="sm"
          variant={motion.enabled ? 'outline' : 'primary'}
          onClick={() => void save({ enabled: !motion.enabled })}
        >
          {motion.enabled ? tr('Turn off') : tr('Turn on')}
        </Button>
      </div>

      {/* When the OS is the reason, the card must SAY it — a setting that
          appears ignored is a bug report waiting to happen. */}
      {!resolved.active && reduced && motion.respectSystemPreference && (
        <p className="rounded-md border border-mirai-border bg-mirai-bg/40 px-3 py-2 text-[11px] leading-relaxed text-mirai-faint">
          {tr('Your operating system asks for reduced motion, and Mirai respects it. ')}
          {tr('You can override that below if you want anyway.')}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px]">{tr('Speed')}</Label>
          <Select
            className="h-8 text-xs"
            value={motion.speed}
            onChange={(e) => void save({ speed: e.target.value as MotionSpeed })}
          >
            {speedOptions.map((speed) => (
              <option key={speed} value={speed}>
                {MOTION_LABELS[speed]}
                {speed !== 'off' && speed !== 'instant' ? ` (${MOTION_MS[speed]}ms)` : ''}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-[10px]">{tr('Page transition')}</Label>
          <Select
            className="h-8 text-xs"
            value={motion.transition}
            onChange={(e) => void save({ transition: e.target.value as TransitionStyle })}
          >
            {(Object.keys(TRANSITION_LABELS) as TransitionStyle[]).map((t) => (
              <option key={t} value={t}>
                {TRANSITION_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-[10px]">{tr('Detail level')}</Label>
          <Select
            className="h-8 text-xs"
            value={motion.detail}
            onChange={(e) => void save({ detail: e.target.value as DetailLevel })}
          >
            {(Object.keys(DETAIL_LABELS) as DetailLevel[]).map((d) => (
              <option key={d} value={d}>
                {DETAIL_LABELS[d]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-[11px] text-mirai-dim">
        <input
          type="checkbox"
          className="accent-mirai-accent"
          checked={motion.respectSystemPreference}
          onChange={(e) => void save({ respectSystemPreference: e.target.checked })}
        />
        {tr('Respect my system\u2019s reduced-motion preference')}
      </label>

      {/* ---- live preview: no screenshot can show a duration ------------- */}
      <div className="rounded-md border border-mirai-border bg-mirai-bg/40 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold text-mirai-dim">
          <Zap className="h-3 w-3" /> {tr('Preview — this is the real setting, not a mockup')}
        </p>
        <div className="flex gap-2">
          <div key={motion.speed + motion.transition} className="animate-view-in rounded-md border border-mirai-border bg-mirai-panel px-3 py-2 text-[11px] text-mirai-dim">
            {describeMotion(motion, reduced)}
          </div>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-mirai-faint">
          {tr('Every transition, hover and entrance in the studio reads this single value. ')}
          {tr('Turning motion off does not make anything slower — it makes it stop.')}
        </p>
      </div>

      {motion.enabled === DEFAULT_MOTION.enabled &&
        motion.speed === DEFAULT_MOTION.speed &&
        motion.detail === DEFAULT_MOTION.detail && (
          <p className="text-[10px] text-mirai-faint">{tr('You are on the recommended default.')}</p>
        )}

      <Button size="sm" variant="ghost" onClick={() => void reload()}>
        {tr('Reload')}
      </Button>

      {motion.enabled === false && (
        <button
          type="button"
          className="text-[10px] text-mirai-accent underline"
          onClick={() => void save({ enabled: true })}
        >
          {tr('Turn it back on')}
        </button>
      )}
    </div>
  )
}