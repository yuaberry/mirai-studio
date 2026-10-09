/**
 * Style Bible (Module 23) — the project's visual identity: art direction,
 * lineart, shading, palette, lighting, proportions, backgrounds, camera
 * language. Autosaves like the Story Bible; the AI context can attach it
 * from Phase 4 on.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, PencilLine } from 'lucide-react'
import type { StyleBible } from '@mirai/shared'
import { Button, Card, Label, Textarea, Spinner } from '../../system/ui'
import { useSettings, useStyleBible, useUpdateStyleBible } from '../../lib/queries'

type SaveState = 'saved' | 'dirty' | 'saving'

/** Mature art-direction presets (Pro) — adult-rated visual identities used by
 *  late-night anime studios. Visible only while Mature Content Mode is on. */
const MATURE_STYLE_PRESETS: Array<{ id: string; label: string; style: StyleBible }> = [
  {
    id: 'sensual-bishoujo',
    label: 'Sensual Bishoujo (late-night)',
    style: {
      artDirection: 'Late-night bishoujo aesthetic — sensual but composed, luminous skin rendering, tasteful framing, romantic atmosphere over explicitness.',
      lineart: 'Fine, confident shoujo-influenced ink with soft tapering; delicate eyelashes and hair strands.',
      shading: 'Two-tone cel with a third ambient gradient on skin; soft blush shading at cheeks and joints.',
      palette: 'Sakura pink, warm ivory skin tones, dusk violet shadows, champagne highlights.',
      lighting: 'Warm rim light on hair and shoulders; candle/lamp key lights; moonlight cool cast for night scenes.',
      proportions: 'Stylized adult bishoujo — long eyelashes, expressive eyes, mature facial structure, elegant neck and shoulders.',
      eyesAndHair: 'Large glossy eyes with dual highlights; flowing hair with per-strand shine bands.',
      backgrounds: 'Soft-focus bokeh interiors; satin and lace texture rendering; painterly window light.',
      cameraLanguage: 'Intimate close-ups, over-shoulder glances, slow push-ins on hands and eyes, 85mm portrait language.',
    },
  },
  {
    id: 'seinen-erotic',
    label: 'Seinen Erotic Drama',
    style: {
      artDirection: 'Seinen erotic drama — mature, restrained sensuality grounded in realistic adult bodies and lived-in spaces.',
      lineart: 'Bold seinen ink with visible weight variation; textured linework on skin.',
      shading: 'Dense screentone gradients; realistic directional shadows; dramatic chiaroscuro in night scenes.',
      palette: 'Desaturated crimsons, ash greys, warm ambers; smoke-haze atmospheric perspective.',
      lighting: 'Hard single-source practicals (neon, streetlamps, bedside lamps); strong cast shadows across bodies.',
      proportions: 'Realistic adult anatomy — seinen proportions, natural body weight, believable musculature.',
      eyesAndHair: 'Sharper adult eyes with subtle highlights; hair with volume and physical behavior.',
      backgrounds: 'Detailed urban apartments, rain-streaked windows, cigarette smoke; cinematic clutter.',
      cameraLanguage: 'Handheld intimacy, Dutch angles for tension, reflections in mirrors/glass, static locked wide shots before emotional beats.',
    },
  },
  {
    id: 'fantasy-succubus',
    label: 'Dark Fantasy Succubus',
    style: {
      artDirection: 'Dark fantasy sensuality — gothic elegance, demonic allure with regal composition.',
      lineart: 'Ornate dark-fantasy linework; filigree detail on horns, wings and costume seams.',
      shading: 'Deep cel shadows with crimson ambient bounce; glowing rune accents.',
      palette: 'Deep crimson, blackened violet, ash grey; glowing magenta accents.',
      lighting: 'Underlighting from demonic glow; candlelit chandeliers; silhouette-first compositions.',
      proportions: 'Tall elegant adult figures; wingspan drama; expressive tail and horn silhouettes.',
      eyesAndHair: 'Slit-pupil glowing eyes; long hair with floating magical definance.',
      backgrounds: 'Cathedral gothic interiors, throne halls, floating embers and silk drapery.',
      cameraLanguage: 'Low-angle power shots, wing-spanning wides, slow reveal cranes, dutch tilts on temptation beats.',
    },
  },
]

const FIELDS: Array<{ key: keyof StyleBible; label: string; hint: string; rows: number; wide?: boolean }> = [
  { key: 'artDirection', label: 'Art direction', hint: 'The overall visual thesis of the work.', rows: 3, wide: true },
  { key: 'lineart', label: 'Lineart', hint: 'Weight, confidence, tapering — e.g. fine shoujo ink vs bold action.', rows: 3 },
  { key: 'shading', label: 'Shading', hint: 'Cel? Screentone? Gradients? Hard or soft shadow edges?', rows: 3 },
  { key: 'palette', label: 'Palette', hint: 'Color swatches and moods — e.g. sakura pink / dusk violet / cyan accents.', rows: 3 },
  { key: 'lighting', label: 'Lighting', hint: 'Key light direction, rim light habits, time-of-day color casts.', rows: 2 },
  { key: 'proportions', label: 'Proportions', hint: 'Head-height ratios, eye size, stylization level.', rows: 2 },
  { key: 'eyesAndHair', label: 'Eyes & hair', hint: 'Eye construction and highlight language; hair silhouette rules.', rows: 3 },
  { key: 'backgrounds', label: 'Backgrounds', hint: 'Painted vs line art, detail density, perspective habits.', rows: 3 },
  { key: 'cameraLanguage', label: 'Camera language', hint: 'Recurring framing, lenses, movement vocabulary of the work.', rows: 3, wide: true },
]

export function StyleBiblePage() {
  const { data: style, isLoading } = useStyleBible()
  const { data: settings } = useSettings()
  const update = useUpdateStyleBible()

  const [draft, setDraft] = useState<StyleBible>({})
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (style && saveState === 'saved') {
      setDraft(style)
    }
  }, [style, saveState])

  const save = (value: StyleBible) => {
    setSaveState('saving')
    update.mutate(value, {
      onSuccess: () => setSaveState('saved'),
      onError: () => setSaveState('dirty'),
    })
  }

  const matureOn = settings?.content?.matureEnabled ?? false
  const applyPreset = (preset: (typeof MATURE_STYLE_PRESETS)[number]) => {
    const next = { ...draft, ...preset.style }
    setDraft(next)
    save(next)
  }

  const onChange = (key: keyof StyleBible, value: string) => {
    const next = { ...draft, [key]: value || undefined }
    setDraft(next)
    setSaveState('dirty')
    if (timer.current) clearTimeout(timer.current)
    const interval = settings?.general.autosaveIntervalMs ?? 5_000
    timer.current = setTimeout(() => save(next), interval)
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-mirai-text">Style Bible</h1>
          <p className="mt-1 text-xs text-mirai-dim">
            The visual identity of the work — every generation and every artist must honor it.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveState === 'saved' && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-mirai-success">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          {saveState === 'saving' && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-mirai-dim">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </span>
          )}
          {saveState === 'dirty' && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-mirai-accent">
              <PencilLine className="h-3.5 w-3.5" /> Editing — autosaves
            </span>
          )}
          <Button
            size="sm"
            variant="primary"
            disabled={saveState !== 'dirty'}
            loading={saveState === 'saving'}
            onClick={() => save(draft)}
          >
            Save Now
          </Button>
        </div>
      </div>

      {matureOn && (
        <div className="mb-5 rounded-xl border border-mirai-danger/30 bg-mirai-danger/5 p-4">
          <p className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-wider text-mirai-danger uppercase">
            Mature style presets (Pro)
          </p>
          <div className="flex flex-wrap gap-2">
            {MATURE_STYLE_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                size="sm"
                variant="outline"
                className="border-mirai-danger/40 text-mirai-danger hover:bg-mirai-danger/10"
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-mirai-faint">
            One click fills the Style Bible with a professional adult-rated visual identity — edit freely afterwards.
          </p>
        </div>
      )}

      <Card className="p-6">
        <div className="grid grid-cols-2 gap-5">
          {FIELDS.map((field) => (
            <div key={field.key} className={field.wide ? 'col-span-2' : ''}>
              <Label htmlFor={`sb2-${field.key}`}>
                {field.label}
                <span className="ml-2 font-normal text-mirai-faint">{field.hint}</span>
              </Label>
              <Textarea
                id={`sb2-${field.key}`}
                rows={field.rows}
                data-selectable="true"
                value={draft[field.key] ?? ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                placeholder={`Define the ${field.label.toLowerCase()}…`}
              />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
