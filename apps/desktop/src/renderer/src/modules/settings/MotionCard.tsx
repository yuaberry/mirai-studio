/**
 * MotionCard — how alive the interface feels (v2.1).
 *
 * The user asked for: beautiful transitions, a switch to speed them up or turn
 * them off, and a choice between minimal and rich detail. This card is that
 * switch, and it shows the RESOLVED value (the OS preference can override the
 * app one — the card says so instead of pretending the setting won).
 *
 * PATTERN NOTE (bug found by live-testing, now fixed): this card used to call
 * the raw IPC itself and read the response wrong (`settings:get` answers
 * `{ settings }`, so the unwrapped data is `{ settings: … }`, not the settings
 * object). The result: every read threw, the catch fell back to DEFAULTS and
 * the selects snapped back to "normal" the moment you touched them — a
 * settings UI that pretends to save. The rest of this page uses the
 * `useSettings()` / `useUpdateSettings()` pair, which unwraps correctly and
 * invalidates the cache on success; this card now does the same.
 */
import { useMemo } from 'react'
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
  type MotionSettings,
} from '@mirai/shared'
import { useSettings, useUpdateSettings } from '../../lib/queries'
import { useT } from '../../lib/i18n'
import { Badge, Button, Card, Label, SectionTitle, Select, Spinner } from '../../system/ui'
import { toast } from '../../store/appStore'

/** Placeholder that guarantees the card has a complete object before the
 *  settings arrive — react-query may briefly hand us `undefined` and a
 *  partial motion object would render invalid <option> values. */
function motionOf(settings: { appearance: { motion: MotionSettings } } | undefined): MotionSettings {
  return settings?.appearance?.motion ?? DEFAULT_MOTION
}

export function MotionCard() {
  const tr = useT()
  const { data: settings, isLoading } = useSettings()
  const update = useUpdateSettings()
  const reduced = useMemo(() => systemPrefersReducedMotion(), [])

  const motion = motionOf(settings)
  const resolved = resolveMotion(motion, reduced)
  const speedOptions: MotionSettings['speed'][] = ['off', 'calm', 'normal', 'swift', 'instant']

  /**
   * SECTION PATCH + PRESERVE: `settings:update` replaces whole sections, so
   * the current `appearance` is spread in first — otherwise changing the
   * motion speed would silently reset the theme, density and UI scale to
   * their defaults (that exact bug bit this app before).
   */
  const save = (patch: Partial<MotionSettings>) => {
    const next = { ...motion, ...patch }
    update.mutate(
      { appearance: { ...(settings?.appearance ?? {}), motion: next } },
      {
        onSuccess: () => toast({ kind: 'success', title: tr('Motion setting saved') }),
        onError: (err) =>
          toast({ kind: 'error', title: tr('Save failed'), description: err.message }),
      },
    )
  }

  if (isLoading) {
    return (
      <Card className="flex h-32 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </Card>
    )
  }

  return (
    <Card className="p-5">
      <SectionTitle
        right={
          <Badge tone={resolved.active ? 'success' : 'neutral'}>
            {resolved.active ? `${tr('on')} · ${resolved.ms}ms` : tr('off')}
          </Badge>
        }
      >
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-mirai-accent" />
          {tr('Interface motion')}
        </span>
      </SectionTitle>

      {/* ---- the master switch, with the resolved truth ------------------ */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[11px] leading-relaxed text-mirai-dim">
          {tr('Transitions between pages, card entrances and hovers — all from one value you control.')}
        </p>
        <Button
          size="sm"
          variant={motion.enabled ? 'outline' : 'primary'}
          loading={update.isPending}
          onClick={() => save({ enabled: !motion.enabled })}
        >
          {motion.enabled ? tr('Turn off') : tr('Turn on')}
        </Button>
      </div>

      {/* When the OS is the reason, the card must SAY it — a setting that
          appears ignored is a bug report waiting to happen. */}
      {!resolved.active && reduced && motion.respectSystemPreference && (
        <p className="mb-3 rounded-md border border-mirai-border bg-mirai-bg/40 px-3 py-2 text-[11px] leading-relaxed text-mirai-faint">
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
            onChange={(e) => save({ speed: e.target.value as MotionSettings['speed'] })}
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
            onChange={(e) => save({ transition: e.target.value as MotionSettings['transition'] })}
          >
            {(Object.keys(TRANSITION_LABELS) as MotionSettings['transition'][]).map((t) => (
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
            onChange={(e) => save({ detail: e.target.value as MotionSettings['detail'] })}
          >
            {(Object.keys(DETAIL_LABELS) as MotionSettings['detail'][]).map((d) => (
              <option key={d} value={d}>
                {DETAIL_LABELS[d]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-[11px] text-mirai-dim">
        <input
          type="checkbox"
          className="accent-mirai-accent"
          checked={motion.respectSystemPreference}
          onChange={(e) => save({ respectSystemPreference: e.target.checked })}
        />
        {tr('Respect my system\u2019s reduced-motion preference')}
      </label>

      {/* ---- live preview: no screenshot can show a duration ------------- */}
      <div className="mt-4 rounded-md border border-mirai-border bg-mirai-bg/40 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold text-mirai-dim">
          <Zap className="h-3 w-3" /> {tr('Preview — this is the real setting, not a mockup')}
        </p>
        <div className="flex gap-2">
          <div
            key={motion.speed + motion.transition}
            className="animate-view-in rounded-md border border-mirai-border bg-mirai-panel px-3 py-2 text-[11px] text-mirai-dim"
          >
            {describeMotion(motion, reduced)}
          </div>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-mirai-faint">
          {tr('Every transition, hover and entrance in the studio reads this single value. ')}
          {tr('Turning motion off does not make anything slower — it makes it stop.')}
        </p>
      </div>

      {motion.enabled === false && (
        <button
          type="button"
          className="mt-2 text-[10px] text-mirai-accent underline"
          onClick={() => save({ enabled: true })}
        >
          {tr('Turn it back on')}
        </button>
      )}
    </Card>
  )
}