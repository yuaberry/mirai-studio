/**
 * New Project modal — creates a REAL project on disk (folder structure,
 * manifest, database, prompt library seed) and opens it.
 */
import { useMemo, useState } from 'react'
import { FolderOpen, Loader2, Sparkles } from 'lucide-react'
import {
  ANIME_GENRES,
  CONTENT_RATINGS,
  filterGenres,
  isMatureGenre,
  ASPECT_RATIOS,
  FPS_OPTIONS,
  HOT_GENRES,
  MiraiError,
  ProjectConfig,
  PROJECT_PRESETS,
  type ProjectPreset,
} from '@mirai/shared'
import { Modal } from '../../system/Modal'
import { Button, FieldError, Input, Label, Select, Textarea } from '../../system/ui'
import { invoke } from '../../lib/ipc'
import { useAnalyzeNotes, useCreateProject, useHealth, useImportNotes, useOpenProject, useSettings } from '../../lib/queries'
import { t } from '../../lib/i18n'
import { useAppStore, toast } from '../../store/appStore'
import { MEDIUM_LABEL, PROJECT_MEDIUMS, type NotesImportResult, type ProjectMedium, type StoryNotesAnalysis } from '@mirai/shared'

interface FormState {
  name: string
  description: string
  dir: string
  presetId: string
  title: string
  genre: string
  genres: string[]
  medium: string
  language: string
  aspectRatio: string
  fps: string
  resolution: string
  episodeCount: string
  contentRating: string
}

function toggleGenre(list: string[], genre: string): string[] {
  if (list.includes(genre)) return list.filter((g) => g !== genre)
  if (list.length >= 12) return list
  return [...list, genre]
}

const RESOLUTIONS: Record<string, { width: number; height: number }> = {
  '1920x1080 (Full HD)': { width: 1920, height: 1080 },
  '2560x1440 (QHD)': { width: 2560, height: 1440 },
  '3840x2160 (4K)': { width: 3840, height: 2160 },
  '1600x900 (HD+)': { width: 1600, height: 900 },
  '1080x1920 (Vertical)': { width: 1080, height: 1920 },
}

const LANGUAGES = [
  { value: 'ja', label: 'Japanese' },
  { value: 'en', label: 'English' },
  { value: 'pt-BR', label: 'Portuguese (BR)' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'es', label: 'Spanish' },
]

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  dir: '',
  presetId: 'anime-12',
  title: '',
  genre: '',
  genres: [],
  medium: '',
  language: 'ja',
  aspectRatio: '16:9',
  fps: '24',
  resolution: '1920x1080 (Full HD)',
  episodeCount: '12',
  contentRating: '13+',
}

export function NewProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: health } = useHealth()
  const createProject = useCreateProject()
  const openProject = useOpenProject()
  const setView = useAppStore((s) => s.setView)

  const { data: settingsData } = useSettings()
  const matureEnabled = settingsData?.content?.matureEnabled ?? false
  const tr = (k: string) => t(settingsData?.general.locale ?? 'en', k)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const importNotes = useImportNotes()
  const analyzeNotes = useAnalyzeNotes()
  const [notes, setNotes] = useState<NotesImportResult | null>(null)
  const [analysis, setAnalysis] = useState<StoryNotesAnalysis | null>(null)

  /** Applies the AI analysis to the form — never overwrites what the user typed. */
  const applyAnalysis = (a: StoryNotesAnalysis) => {
    setForm((f) => ({
      ...f,
      name: f.name.trim() ? f.name : a.titleSuggestion.slice(0, 80),
      title: f.title.trim() ? f.title : a.titleSuggestion,
      description: f.description.trim() ? f.description : a.premise,
      medium: f.medium || a.medium,
      episodeCount:
        f.episodeCount.trim() && f.episodeCount !== '12' ? f.episodeCount : String(Math.min(a.estimatedEpisodes, 999)),
      contentRating:
        f.contentRating !== '13+' || a.contentRating === '18+'
          ? a.contentRating && f.contentRating === '13+'
            ? a.contentRating
            : f.contentRating
          : f.contentRating,
      // Only genre tags that exist in the taxonomy — the rest stay visible
      // in the analysis panel for the user to map.
      genres: Array.from(new Set([...f.genres, ...a.genres]))
        .filter((g) => (ANIME_GENRES as readonly string[]).includes(g))
        .slice(0, 12),
    }))
  }

  const runAnalysis = () => {
    if (!notes) return
    analyzeNotes.mutate(notes.combined, {
      onSuccess: (a) => {
        setAnalysis(a)
        applyAnalysis(a)
        toast({ kind: 'success', title: tr('Notes analyzed'), description: a.titleSuggestion })
      },
      onError: (err) => toast({ kind: 'error', title: tr('Analysis failed'), description: err.message }),
    })
  }

  const preset: ProjectPreset | undefined = useMemo(
    () => PROJECT_PRESETS.find((p) => p.id === form.presetId),
    [form.presetId],
  )

  const set = (key: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
    setFieldErrors((e) => {
      if (!e[key]) return e
      const next = { ...e }
      delete next[key]
      return next
    })
  }

  const applyPreset = (presetId: string) => {
    const p = PROJECT_PRESETS.find((x) => x.id === presetId)
    setForm((f) => ({
      ...f,
      presetId,
      ...(p?.config.episodeCount !== undefined ? { episodeCount: String(p.config.episodeCount) } : {}),
      ...(p?.config.aspectRatio ? { aspectRatio: p.config.aspectRatio } : {}),
      ...(p?.config.fps ? { fps: String(p.config.fps) } : {}),
      ...(p?.config.resolution
        ? {
            resolution:
              Object.entries(RESOLUTIONS).find(
                ([, r]) => r.width === p.config.resolution?.width && r.height === p.config.resolution?.height,
              )?.[0] ?? f.resolution,
          }
        : {}),
    }))
  }

  const browse = async () => {
    try {
      const { path } = await invoke('projects:pickDirectory')
      if (path) set('dir', path)
    } catch (err) {
      toast({ kind: 'error', title: 'Folder picker failed', description: (err as Error).message })
    }
  }

  const submit = async () => {
    setServerError(null)
    const errors: Record<string, string> = {}
    if (!form.name.trim()) errors.name = 'Give your project a name.'
    if (!form.title.trim()) errors.title = 'The work needs a title.'
    const dir = form.dir.trim() || health?.projectsDefaultDir || ''
    if (!dir) errors.dir = 'Choose where the project folder will live.'
    if (form.episodeCount !== '' && !/^\d+$/.test(form.episodeCount)) {
      errors.episodeCount = 'Episodes must be a number (or empty).'
    }
    const resolution = RESOLUTIONS[form.resolution] ?? { width: 1920, height: 1080 }
    const parsed = ProjectConfig.safeParse({
      title: form.title.trim(),
      genre: form.genre.trim() || undefined,
      genres: form.genres,
      medium: (form.medium || undefined) as ProjectMedium | undefined,
      language: form.language,
      aspectRatio: form.aspectRatio,
      fps: Number(form.fps),
      resolution,
      episodeCount: form.episodeCount === '' ? undefined : Number(form.episodeCount),
      visualStyle: preset?.config.visualStyle,
      contentRating: (form.contentRating as 'ALL' | '7+' | '13+' | '16+' | '18+') ?? undefined,
    })
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors[String(issue.path[0] ?? 'config')] = issue.message
      }
    }
    setFieldErrors(errors)
    if (!parsed.success || Object.keys(errors).length > 0) return

    createProject.mutate(
      {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        dir,
        config: parsed.data,
      },
      {
        onSuccess: (project) => {
          toast({ kind: 'success', title: `Project “${project.name}” created` })
          openProject.mutate(project.path, {
            onSuccess: () => {
              setView('overview')
              onClose()
              setForm({ ...EMPTY_FORM })
            },
            onError: (err) =>
              setServerError(err instanceof MiraiError ? err.message : `Open failed: ${err.message}`),
          })
        },
        onError: (err) =>
          setServerError(err instanceof MiraiError ? err.message : `Create failed: ${err.message}`),
      },
    )
  }

  const busy = createProject.isPending || openProject.isPending

  return (
    <Modal
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title="New Project"
      description="Mirai creates the full production folder, database, manifest and a curated prompt library — no placeholders."
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => (busy ? undefined : onClose())}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy}>
            <Sparkles className="h-4 w-4" /> Create & Open
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label htmlFor="np-name">{tr('Project name')}</Label>
          <Input
            id="np-name"
            placeholder="Sakura Chronicles"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            autoFocus
          />
          <FieldError message={fieldErrors.name} />
        </div>

        <div className="col-span-2">
          <Label htmlFor="np-desc">{tr('Description')}</Label>
          <Textarea
            id="np-desc"
            rows={2}
            placeholder="A yuri romance set in a school of magic — optional, helps the AI later."
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>

        {/* ---- Story-notes import + AI analysis (v0.15) ---- */}
        <div className="col-span-2 rounded-lg border border-mirai-border bg-mirai-panel p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              loading={importNotes.isPending}
              onClick={() =>
                importNotes.mutate(undefined, {
                  onSuccess: (result) => {
                    setNotes(result)
                    setAnalysis(null)
                    toast({
                      kind: 'success',
                      title: tr('Notes imported'),
                      description: `${result.files.length} ${tr('files')} · ${result.totalChars.toLocaleString()} ${tr('characters')}`,
                    })
                  },
                  onError: (err) => toast({ kind: 'error', title: tr('Import failed'), description: err.message }),
                })
              }
            >
              {tr('Import story notes…')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!notes}
              loading={analyzeNotes.isPending}
              onClick={runAnalysis}
            >
              {tr('Analyze with AI')}
            </Button>
            <span className="text-[10px] text-mirai-faint">
              .txt · .md · .docx · .odt · .pdf · .zip — {tr('Google Docs exports included')}
            </span>
          </div>
          {notes && (
            <div className="mt-2 space-y-1">
              <p className="text-[10px] font-bold tracking-wider text-mirai-faint uppercase">
                {tr('Imported')} ({notes.files.length})
              </p>
              {notes.files.map((f) => (
                <p key={f.name} className="truncate text-[11px] text-mirai-dim">
                  📄 {f.name} · {f.format} · {f.chars.toLocaleString()} {tr('characters')}
                  {f.truncated && <span className="text-amber-400"> · {tr('truncated')}</span>}
                </p>
              ))}
              {notes.skipped.map((s) => (
                <p key={s.name} className="truncate text-[11px] text-amber-400/80">
                  ⚠ {s.name} — {s.reason}
                </p>
              ))}
            </div>
          )}
          {analysis && (
            <div className="mt-3 space-y-2 rounded-md border border-mirai-border-strong bg-mirai-raise/50 p-2.5">
              <p className="text-[10px] font-bold tracking-wider text-mirai-accent uppercase">
                {tr('AI professional analysis')}
              </p>
              <p className="text-[11px] leading-relaxed text-mirai-dim">{analysis.premise}</p>
              <p className="text-[11px] leading-relaxed text-mirai-dim">
                <span className="font-bold text-mirai-text">{tr('Suggested')}:</span> {analysis.titleSuggestion} ·{' '}
                {analysis.medium} · {analysis.estimatedEpisodes} {tr('episodes')} · {analysis.suggestedAudience}
              </p>
              {analysis.improvements.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-mirai-text">{tr('Improvements')}</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {analysis.improvements.slice(0, 6).map((i, idx) => (
                      <li key={idx} className="text-[11px] leading-snug text-mirai-dim">
                        • {i}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.risks.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-mirai-text">{tr('Risks')}</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {analysis.risks.slice(0, 4).map((r, idx) => (
                      <li key={idx} className="text-[11px] leading-snug text-amber-300/90">
                        • {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[11px] leading-relaxed text-mirai-faint">
                <span className="font-bold text-mirai-dim">{tr('Commercial notes')}:</span> {analysis.commercialNotes}
              </p>
              <Button size="sm" variant="outline" onClick={() => applyAnalysis(analysis)}>
                {tr('Apply to form')}
              </Button>
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="np-preset">{tr('Template')}</Label>
          <Select id="np-preset" value={form.presetId} onChange={(e) => applyPreset(e.target.value)}>
            {PROJECT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="np-medium">{tr('Medium')}</Label>
          <Select id="np-medium" value={form.medium} onChange={(e) => set('medium', e.target.value)}>
            <option value="">{tr('Choose…')}</option>
            {PROJECT_MEDIUMS.map((m) => (
              <option key={m} value={m}>
                {tr(MEDIUM_LABEL[m])}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="np-dir">{tr('Location')}</Label>
          <div className="flex gap-2">
            <Input
              id="np-dir"
              readOnly
              placeholder={health?.projectsDefaultDir ?? tr('Choose folder…')}
              value={form.dir}
              className="cursor-pointer text-mirai-faint"
              onClick={() => void browse()}
            />
            <Button variant="outline" onClick={() => void browse()} className="shrink-0">
              <FolderOpen className="h-4 w-4" /> {tr('Choose folder…')}
            </Button>
          </div>
          <p className="mt-1 truncate text-[10px] text-mirai-faint">
            {form.dir || health?.projectsDefaultDir || ''}
          </p>
          <FieldError message={fieldErrors.dir} />
        </div>

        <div>
          <Label htmlFor="np-title">{tr('Work title')}</Label>
          <Input
            id="np-title"
            placeholder="Sakura Chronicles"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
          />
          <FieldError message={fieldErrors.title} />
        </div>

        <div>
          <Label htmlFor="np-genre">{tr('Genre (free text)')}</Label>
          <Input
            id="np-genre"
            placeholder="Romance, Fantasy, Drama"
            value={form.genre}
            onChange={(e) => set('genre', e.target.value)}
          />
        </div>

        <div>
          <Label>
            Anime genres
            <span className="ml-2 font-normal text-mirai-faint">
              tap to tag — Isekai, Ecchi, Psychological… (max 12)
            </span>
          </Label>
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-mirai-border bg-mirai-panel p-2">
            {filterGenres(ANIME_GENRES, matureEnabled).map((genre) => {
              const active = form.genres.includes(genre)
              const hot = HOT_GENRES.has(genre)
              return (
                <button
                  key={genre}
                  type="button"
                  onClick={() =>
                    setForm((f) => {
                      const genres = toggleGenre(f.genres, genre)
                      // Auto-rate 18+ when a mature genre is picked with Mature Mode on.
                      const autoRating =
                        matureEnabled && genres.some(isMatureGenre) && f.contentRating !== '18+'
                          ? '18+'
                          : f.contentRating
                      return { ...f, genres, contentRating: autoRating }
                    })
                  }
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    active
                      ? hot
                        ? 'border-mirai-accent/40 bg-mirai-accent/15 text-mirai-accent'
                        : 'border-mirai-accent-2/40 bg-mirai-accent-2/15 text-mirai-accent-2'
                      : 'border-mirai-border-strong bg-mirai-raise text-mirai-faint hover:text-mirai-dim'
                  }`}
                >
                  {genre}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <Label htmlFor="np-lang">{tr('Language')}</Label>
          <Select id="np-lang" value={form.language} onChange={(e) => set('language', e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="np-eps">{tr('Episodes')}</Label>
          <Input
            id="np-eps"
            inputMode="numeric"
            placeholder="12"
            value={form.episodeCount}
            onChange={(e) => set('episodeCount', e.target.value)}
          />
          <FieldError message={fieldErrors.episodeCount} />
        </div>

        <div>
          <Label htmlFor="np-aspect">{tr('Aspect ratio')}</Label>
          <Select
            id="np-aspect"
            value={form.aspectRatio}
            onChange={(e) => set('aspectRatio', e.target.value)}
          >
            {ASPECT_RATIOS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="np-res">{tr('Resolution')}</Label>
          <Select
            id="np-res"
            value={form.resolution}
            onChange={(e) => set('resolution', e.target.value)}
          >
            {Object.keys(RESOLUTIONS).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="np-fps">{tr('FPS')}</Label>
          <Select id="np-fps" value={form.fps} onChange={(e) => set('fps', e.target.value)}>
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={String(f)}>
                {f}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="np-rating">
            Content rating
            {form.contentRating === '18+' && (
              <span className="ml-2 font-bold text-mirai-danger">{tr('18+ — adult content enabled for this production')}</span>
            )}
          </Label>
          <Select id="np-rating" value={form.contentRating} onChange={(e) => set('contentRating', e.target.value)}>
            {CONTENT_RATINGS.map((r) => (
              <option key={r} value={r}>
                {r === 'ALL' ? tr('All ages') : r === '18+' ? tr('18+ — adults only (Mature Mode)') : r}
              </option>
            ))}
          </Select>
          <FieldError message={fieldErrors.config} />
          {matureEnabled && form.genres.some(isMatureGenre) && (
            <p className="mt-1 text-[10px] font-semibold text-mirai-danger">
              {tr('Mature genre selected — rating locked to 18+ by the adults-only policy.')}
            </p>
          )}
        </div>

        {serverError && (
          <div className="col-span-2 rounded-md border border-mirai-danger/30 bg-mirai-danger/10 px-3 py-2 text-xs text-mirai-danger">
            {serverError}
          </div>
        )}
        {busy && (
          <p className="col-span-2 flex items-center gap-2 text-xs text-mirai-dim">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating project on disk…
          </p>
        )}
      </div>
    </Modal>
  )
}
