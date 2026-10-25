/**
 * LocalizationPage (v0.29, §18 Localization Lab) — the translation
 * workflow: per-language coverage bars, SIDE-BY-SIDE original vs
 * translation editing per scene, statuses, AI translation drafts
 * (glossary-honoring, human-saved), the project glossary (term base),
 * and the translated EPUB export with honest fallback counts.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  Languages,
  Plus,
  Save,
  Trash2,
  Wand2,
} from 'lucide-react'
import {
  MiraiError,
  TRANSLATION_STATUSES,
  type SceneRecord,
  type TranslationStatus,
} from '@mirai/shared'
import { Badge, Button, Input, Label, Select, Textarea } from '../../system/ui'
import { EmptyState, ErrorState } from '../../system/EmptyState'
import { SkeletonList } from '../../system/Skeleton'
import { ConfirmModal } from '../../system/Modal'
import {
  useEpisodes,
  useScenes,
  useTranslationList,
  useTranslationMutations,
  useCoverage,
  useGlossary,
  useGlossaryMutations,
  useSceneTranslate,
  useTranslatedEpubExport,
  useTranslatedEpubReveal,
} from '../../lib/queries'
import { toast } from '../../store/appStore'
import { T } from '../../system/T'

const LANG_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/

export function LocalizationPage() {
  const { data: episodes, isLoading: epLoading, isError: epError, error: epErr, refetch: refetchEp } = useEpisodes()
  const { data: coverage } = useCoverage()
  const exportEpub = useTranslatedEpubExport()
  const revealEpub = useTranslatedEpubReveal()
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null)
  const [langDraft, setLangDraft] = useState('')
  const [activeLang, setActiveLang] = useState<string | null>(null)

  const episode = useMemo(
    () => (episodes ?? []).find((e) => e.id === selectedEpisodeId) ?? null,
    [episodes, selectedEpisodeId],
  )

  useEffect(() => {
    if (!selectedEpisodeId && episodes && episodes.length > 0) setSelectedEpisodeId(episodes[0]!.id)
  }, [episodes, selectedEpisodeId])

  // first language becomes active automatically
  useEffect(() => {
    if (activeLang === null && coverage && coverage.length > 0) setActiveLang(coverage[0]!.language)
  }, [coverage, activeLang])

  const addLanguage = () => {
    const tag = langDraft.trim()
    if (!LANG_RE.test(tag)) {
      toast({ kind: 'error', title: 'Invalid language tag', description: 'Use en-US, pt-BR, ja…' })
      return
    }
    setActiveLang(tag)
    setLangDraft('')
  }

  if (epLoading) return <SkeletonList rows={6} />
  if (epError) {
    return (
      <ErrorState
        title="Episodes failed to load"
        message={epErr instanceof MiraiError ? epErr.message : 'Unknown error'}
        onRetry={() => void refetchEp()}
      />
    )
  }
  if ((episodes ?? []).length === 0) {
    return (
      <EmptyState
        icon={<Languages className="h-5 w-5" />}
        title="Nothing to translate yet"
        description="Create episodes and write scene screenplays first — every scene becomes translatable."
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      {/* -------------------------------------------------- header + languages */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-xl font-bold text-mirai-text">
            <Languages className="h-5 w-5 text-mirai-accent" /> <T k="Localization" />
          </h1>
          <p className="mt-1 text-xs text-mirai-dim">
            <T k="Translate scenes with a glossary the AI must honor — side by side, human approved." />
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="h-8 w-36 text-xs"
            placeholder="pt-BR, en-US, ja…"
            value={langDraft}
            onChange={(e) => setLangDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addLanguage()}
          />
          <Button size="sm" variant="outline" onClick={addLanguage}>
            <Plus className="h-3.5 w-3.5" /> <T k="Language" />
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------------- coverage bars */}
      {(coverage ?? []).length > 0 ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {(coverage ?? []).map((cov) => {
            const pct = cov.total > 0 ? Math.round((cov.translated / cov.total) * 100) : 0
            const active = cov.language === activeLang
            return (
              <button
                key={cov.language}
                onClick={() => setActiveLang(cov.language)}
                className={`min-w-40 rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? 'border-mirai-accent/50 bg-mirai-accent/10'
                    : 'border-mirai-border bg-mirai-panel/40 hover:border-mirai-border-strong'
                }`}
              >
                <p className="flex items-center justify-between text-xs font-bold text-mirai-text">
                  {cov.language}
                  <span className="text-[10px] text-mirai-faint">
                    {cov.translated}/{cov.total}
                  </span>
                </p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-mirai-hover">
                  <div className="h-full rounded-full bg-gradient-mirai transition-all" style={{ width: `${pct}%` }} />
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="mb-6 text-[11px] text-mirai-faint">
          No target languages yet — add one (e.g. pt-BR) to start translating.
        </p>
      )}

      {activeLang ? (
        <>
          {/* --------------------------------------------------- scene picker */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select
              className="h-8 max-w-64 text-xs"
              value={selectedEpisodeId ?? ''}
              onChange={(e) => setSelectedEpisodeId(e.target.value)}
            >
              {(episodes ?? []).map((ep) => (
                <option key={ep.id} value={ep.id}>
                  S{ep.season}E{ep.number} — {ep.title}
                </option>
              ))}
            </Select>
            <div className="ml-auto flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                title={`Reveal the ${activeLang} EPUB in the file manager`}
                onClick={() =>
                  revealEpub.mutate(activeLang, {
                    onError: (err) => toast({ kind: 'error', title: 'Reveal failed', description: err.message }),
                  })
                }
              >
                ↗
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={exportEpub.isPending}
                title={`Export the EPUB with ${activeLang} translations (falls back to the source where missing)`}
                onClick={() =>
                  exportEpub.mutate(activeLang, {
                    onSuccess: (r) =>
                      toast({
                        kind: 'success',
                        title: `EPUB ${activeLang} exported`,
                        description: `${r.chapters} chapters · ${r.translatedScenes} translated · ${r.fallbackScenes} fallback — ${r.epubPath}`,
                      }),
                    onError: (err) =>
                      toast({ kind: 'error', title: 'EPUB export failed', description: err.message }),
                  })
                }
              >
                <BookOpen className="h-3.5 w-3.5" /> <T k="EPUB" /> ({activeLang})
              </Button>
            </div>
          </div>

          {episode ? <SceneWorkbench episodeId={episode.id} language={activeLang} /> : null}

          {/* ------------------------------------------------------- glossary */}
          <GlossaryPanel language={activeLang} />
        </>
      ) : null}
    </div>
  )
}

// --------------------------------------------------------------- workbench

function SceneWorkbench({ episodeId, language }: { episodeId: string; language: string }) {
  const { data: scenes, isLoading, isError, error, refetch } = useScenes(episodeId)
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)

  useEffect(() => {
    if (scenes && scenes.length > 0 && !(scenes ?? []).some((s) => s.id === selectedSceneId)) {
      setSelectedSceneId(scenes[0]!.id)
    }
  }, [scenes, selectedSceneId])

  const scene = (scenes ?? []).find((s) => s.id === selectedSceneId) ?? null

  if (isLoading) return <SkeletonList rows={4} />
  if (isError) {
    return (
      <ErrorState
        title="Scenes failed to load"
        message={error instanceof MiraiError ? error.message : 'Unknown error'}
        onRetry={() => void refetch()}
      />
    )
  }
  if ((scenes ?? []).length === 0) {
    return <EmptyState icon={<Languages className="h-5 w-5" />} title="No scenes in this episode" className="min-h-24" />
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(scenes ?? []).map((sc) => (
          <button
            key={sc.id}
            onClick={() => setSelectedSceneId(sc.id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              sc.id === selectedSceneId
                ? 'border-mirai-accent/40 bg-mirai-accent/15 text-mirai-accent'
                : 'border-mirai-border-strong bg-mirai-panel text-mirai-faint hover:text-mirai-dim'
            }`}
          >
            {sc.title}
          </button>
        ))}
      </div>
      {scene ? <SideBySide scene={scene} language={language} /> : null}
    </div>
  )
}

// --------------------------------------------------------------- side-by-side

function SideBySide({ scene, language }: { scene: SceneRecord; language: string }) {
  const { data: translations, refetch: refetchTranslations } = useTranslationList(scene.id)
  const mutations = useTranslationMutations()
  const aiTranslate = useSceneTranslate()

  const existing = (translations ?? []).find((t) => t.language === language) ?? null
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<TranslationStatus>('DRAFT')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setDraft(existing?.screenplay ?? '')
    setStatus(existing?.status ?? 'DRAFT')
  }, [existing?.id, existing?.screenplay, existing?.status, language, scene.id])

  const dirty = draft !== (existing?.screenplay ?? '')

  const save = () => {
    mutations.upsert.mutate(
      { sceneId: scene.id, input: { language, screenplay: draft, status } },
      {
        onSuccess: () => toast({ kind: 'success', title: `Translation saved (${language})` }),
        onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
      },
    )
  }

  const ai = () => {
    aiTranslate.mutate(
      { sceneId: scene.id, language },
      {
        onSuccess: (r) => {
          setDraft(r.screenplay)
          setStatus('DRAFT')
          toast({
            kind: 'success',
            title: 'AI draft ready',
            description: 'Review it — it is NOT saved until you press Save.',
          })
          void refetchTranslations()
        },
        onError: (err) => toast({ kind: 'error', title: 'Translation failed', description: err.message }),
      },
    )
  }

  return (
    <div className="rounded-lg border border-mirai-border bg-mirai-panel/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone="accent">{language}</Badge>
        <span className="text-xs font-semibold text-mirai-text">{scene.title}</span>
        {existing ? <Badge tone={existing.status === 'FINAL' ? 'success' : 'info'}>{existing.status}</Badge> : null}
        <div className="ml-auto flex items-center gap-1.5">
          <Select
            className="h-8 w-32 text-xs"
            value={status}
            onChange={(e) => setStatus(e.target.value as TranslationStatus)}
          >
            {TRANSLATION_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </Select>
          {existing ? (
            <Button
              size="sm"
              variant="outline"
              title={`Delete the ${language} translation`}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            loading={aiTranslate.isPending}
            disabled={!scene.screenplay}
            title={scene.screenplay ? 'AI translates honoring the glossary — you review and save' : 'The scene has no screenplay yet'}
            onClick={ai}
          >
            <Wand2 className="h-3.5 w-3.5" /> <T k="AI translate" />
          </Button>
          <Button size="sm" variant="primary" disabled={!dirty || draft.trim().length === 0} loading={mutations.upsert.isPending} onClick={save}>
            <Save className="h-3.5 w-3.5" /> <T k="Save translation" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <Label className="text-[10px] tracking-wider text-mirai-faint uppercase">
            <T k="Source" />
          </Label>
          <div className="min-h-40 rounded-md border border-mirai-border/70 bg-mirai-bg/40 p-3 text-xs leading-relaxed whitespace-pre-wrap text-mirai-dim">
            {scene.screenplay?.trim() || <span className="italic text-mirai-faint">no screenplay yet</span>}
          </div>
        </div>
        <div>
          <Label className="text-[10px] tracking-wider text-mirai-faint uppercase">
            {language} {dirty ? <span className="text-mirai-accent">•</span> : null}
          </Label>
          <Textarea
            rows={8}
            className="min-h-40 text-xs"
            placeholder={`The ${language} translation appears here…`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
      </div>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete the ${language} translation?`}
        description="The original screenplay stays untouched. You can re-translate anytime."
        confirmLabel="Delete translation"
        danger
        onConfirm={() => {
          mutations.remove.mutate(
            { sceneId: scene.id, language },
            {
              onSuccess: () => {
                setConfirmDelete(false)
                toast({ kind: 'success', title: 'Translation deleted' })
              },
              onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }),
            },
          )
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------- glossary

function GlossaryPanel({ language }: { language: string }) {
  const { data: terms, isLoading } = useGlossary(language)
  const mutations = useGlossaryMutations()
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [notes, setNotes] = useState('')

  const add = () => {
    if (source.trim().length === 0 || target.trim().length === 0) return
    mutations.upsert.mutate(
      { source: source.trim(), target: target.trim(), language, notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          setSource('')
          setTarget('')
          setNotes('')
          toast({ kind: 'success', title: 'Glossary term saved' })
        },
        onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
      },
    )
  }

  return (
    <div className="mt-6 rounded-lg border border-mirai-border bg-mirai-panel/40 p-4">
      <h2 className="mb-1 font-display text-[11px] font-bold tracking-[0.16em] text-mirai-text uppercase">
        <T k="Glossary" /> <span className="ml-1 normal-case text-mirai-faint">({language})</span>
      </h2>
      <p className="mb-3 text-[11px] text-mirai-faint">
        the term base the AI MUST honor when translating into {language}
      </p>

      <div className="mb-3 grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
        <Input className="h-8 text-xs" placeholder="source term (e.g. Lampião de Prata)" value={source} onChange={(e) => setSource(e.target.value)} />
        <Input className="h-8 text-xs" placeholder={`approved ${language} translation`} value={target} onChange={(e) => setTarget(e.target.value)} />
        <Input className="h-8 text-xs" placeholder="notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button size="sm" variant="outline" disabled={source.trim().length === 0 || target.trim().length === 0} loading={mutations.upsert.isPending} onClick={add}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {isLoading ? (
        <SkeletonList rows={2} />
      ) : (terms ?? []).length === 0 ? (
        <p className="text-[11px] text-mirai-faint">No terms yet — names, places and coined terms belong here.</p>
      ) : (
        <ul className="space-y-1">
          {(terms ?? []).map((term) => (
            <li key={term.id} className="flex items-center gap-2 rounded border border-mirai-border/70 bg-mirai-bg/40 px-3 py-1.5 text-xs">
              <span className="font-semibold text-mirai-text">{term.source}</span>
              <span className="text-mirai-faint">→</span>
              <span className="text-mirai-accent">{term.target}</span>
              {term.notes ? <span className="truncate text-[10px] text-mirai-faint">{term.notes}</span> : null}
              <button
                className="ml-auto rounded p-1 text-mirai-faint hover:text-red-400"
                title="Remove term"
                onClick={() =>
                  mutations.remove.mutate(term.id, {
                    onError: (err) => toast({ kind: 'error', title: 'Remove failed', description: err.message }),
                  })
                }
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
