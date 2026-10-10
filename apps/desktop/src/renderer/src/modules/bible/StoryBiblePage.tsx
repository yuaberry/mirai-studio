/**
 * Story Bible (Module 03) — the narrative memory the AI consults (Phase 2).
 * Full-document autosave with debounce + explicit save state.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, PencilLine } from 'lucide-react'
import type { StoryBible } from '@mirai/shared'
import { Button, Card, Label, Textarea, Spinner } from '../../system/ui'
import { useSettings, useStoryBible, useUpdateStoryBible } from '../../lib/queries'

type SaveState = 'saved' | 'dirty' | 'saving'

const FIELDS: Array<{ key: keyof StoryBible; label: string; hint: string; rows: number; wide?: boolean }> = [
  { key: 'premise', label: 'Premise', hint: 'The story in two or three sentences.', rows: 3, wide: true },
  { key: 'themes', label: 'Themes', hint: 'What the work is really about.', rows: 2 },
  { key: 'tone', label: 'Tone', hint: 'Bittersweet? Comedic? Melancholic?', rows: 2 },
  { key: 'message', label: 'Message', hint: 'What should the audience take away?', rows: 2 },
  { key: 'narrativeRules', label: 'Narrative rules', hint: 'How magic/conflict works here — rules the story must never break.', rows: 5, wide: true },
  { key: 'coreConcepts', label: 'Core concepts', hint: 'Original terms of the world (e.g. "Lumen Cores").', rows: 4, wide: true },
  { key: 'genreNotes', label: 'Genre notes', hint: 'Subgenres, references, influences.', rows: 2 },
]

export function StoryBiblePage() {
  const { data: bible, isLoading } = useStoryBible()
  const { data: settings } = useSettings()
  const update = useUpdateStoryBible()

  const [draft, setDraft] = useState<StoryBible>({})
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (bible && saveState === 'saved') {
      setDraft(bible)
    }
  }, [bible, saveState])

  const save = (value: StoryBible) => {
    setSaveState('saving')
    update.mutate(value, {
      onSuccess: () => setSaveState('saved'),
      onError: () => setSaveState('dirty'),
    })
  }

  const onChange = (key: keyof StoryBible, value: string) => {
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
          <h1 className="font-display text-xl font-bold text-mirai-text">Story Bible</h1>
          <p className="mt-1 text-xs text-mirai-dim">
            The DNA of the work. The AI Assist consults this before generating anything.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator state={saveState} />
          <Button
            size="sm"
            variant="primary"
            disabled={saveState === 'saved' || saveState === 'saving'}
            loading={saveState === 'saving'}
            onClick={() => save(draft)}
          >
            Save Now
          </Button>
        </div>
      </div>

      <Card className="p-6">
        <div className="grid grid-cols-2 gap-5">
          {FIELDS.map((field) => (
            <div key={field.key} className={field.wide ? 'col-span-2' : ''}>
              <Label htmlFor={`sb-${field.key}`}>
                {field.label}
                <span className="ml-2 font-normal text-mirai-faint">{field.hint}</span>
              </Label>
              <Textarea
                id={`sb-${field.key}`}
                rows={field.rows}
                data-selectable="true"
                value={draft[field.key] ?? ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                placeholder={`Write the ${field.label.toLowerCase()}…`}
              />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saved') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-mirai-success">
        <Check className="h-3.5 w-3.5" /> Saved
      </span>
    )
  }
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-mirai-dim">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-mirai-accent">
      <PencilLine className="h-3.5 w-3.5" /> Editing — autosaves
    </span>
  )
}
