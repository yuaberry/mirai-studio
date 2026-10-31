/**
 * LocalizationPage (§18 Localization Lab — V1 Beta Experimental 5) — the
 * translation workflow: per-language coverage bars, scenes × languages
 * status matrix, SIDE-BY-SIDE original vs translation editing per scene,
 * governed status transitions (DRAFT → REVIEW → APPROVED → FINAL) with
 * reviewer comments, AI translation drafts (glossary-honoring,
 * human-saved), the project glossary (term base), audit trail, and the
 * translated EPUB export with stale/draft pre-flight validation.
 */
import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Languages, Plus, Save, Trash2 } from 'lucide-react'
import { Badge, Button, Input, Label, PageHeader, Select, Textarea } from '../../system/ui'
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
  useTranslatedEpubExport,
  useTranslatedEpubReveal,
  useTranslationTransition,
  useTranslationAudit,
  useTranslationMatrix,
  useEpubValidation,
} from '../../lib/queries'
import type { TranslationStatus } from '@mirai/shared'
import { toast } from '../../store/appStore'
import { T } from '../../system/T'

const LANG_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/

const STATUS_COLOR: Record<TranslationStatus, string> = {
  DRAFT: '#94a3b8',
  REVIEW: '#fbbf24',
  APPROVED: '#34d399',
  FINAL: '#22d3ee',
}

// ------------------------------------------------------------------ page

export function LocalizationPage() {
  const { data: episodes, isLoading: epLoading, isError: epError, error: epErr, refetch: refetchEp } = useEpisodes()
  const { data: coverage } = useCoverage()
  const exportEpub = useTranslatedEpubExport()
  const revealEpub = useTranslatedEpubReveal()
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null)
  const [langDraft, setLangDraft] = useState('')
  const [activeLang, setActiveLang] = useState<string | null>(null)
  // Always call hooks unconditionally (React rules)
  const epubValidation = useEpubValidation(activeLang ?? undefined)

  const episode = useMemo(
    () => (episodes ?? []).find((e) => e.id === selectedEpisodeId) ?? null,
    [episodes, selectedEpisodeId],
  )

  // Matrix data for all languages × scenes of the selected episode
  const matrix = useTranslationMatrix(selectedEpisodeId ?? undefined)
  const matrixData = matrix.data
  const matrixEntries = useMemo(() => {
    if (!matrixData) return []
    const unique: Array<{ id: string; title: string }> = []
    const seen = new Set<string>()
    for (const e of matrixData.entries) {
      if (!seen.has(e.sceneId)) {
        seen.add(e.sceneId)
        unique.push({ id: e.sceneId, title: e.sceneTitle })
      }
    }
    return unique
  }, [matrixData])

  useEffect(() => {
    if (!selectedEpisodeId && episodes && episodes.length > 0) setSelectedEpisodeId(episodes[0]!.id)
  }, [episodes, selectedEpisodeId])

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
        message={epErr instanceof Error ? epErr.message : 'Unknown error'}
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

  const epubCheck = epubValidation.data

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      {/* -------------------------------------------------- header */}
      <PageHeader
        title="Localization"
        subtitle="Translate scenes with a glossary the AI must honor — side by side, human approved."
      />

      {/* ------------------------------------------------------- coverage bars */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2 mb-3">
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
        {(coverage ?? []).length > 0 ? (
          <div className="flex flex-wrap gap-2">
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
                  {pct === 100 && (
                    <Badge tone="success" className="ml-2 text-[10px]">
                      complete
                    </Badge>
                  )}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="mb-6 text-[11px] text-mirai-faint">
            No target languages yet — add one (e.g. pt-BR) to start translating.
          </p>
        )}
      </div>

      {activeLang ? (
        <>
          {/* --------------------------------------------------- scene picker + actions */}
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
            <div className="ml-auto flex items-center gap-1.5">
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
                disabled={epubCheck?.ok === false}
                loading={exportEpub.isPending}
                title={`Export the EPUB with ${activeLang} translations (falls back to the source where missing)`}
                onClick={() => {
                  if (epubCheck?.warnings?.length) {
                    toast({
                      kind: 'warning',
                      title: 'EPUB export warnings',
                      description: epubCheck.warnings.join('; '),
                    })
                  }
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
                }}
              >
                <BookOpen className="h-3.5 w-3.5" /> <T k="EPUB" /> ({activeLang})
              </Button>
              {epubCheck?.warnings?.length && (
                <Badge tone="warn" className="text-[10px]">
                  ⚠ {epubCheck.warnings.length} issue(s)
                </Badge>
              )}
            </div>
          </div>

          {episode && (
            <>
              <TranslationMatrixPanel episodeId={episode.id} matrixEntries={matrixEntries} />
              <SceneWorkbench episodeId={episode.id} language={activeLang} />
            </>
          )}

          {/* ------------------------------------------------------- glossary */}
          <GlossaryPanel language={activeLang} />
        </>
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------ workbench

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
        message={error instanceof Error ? error.message : 'Unknown error'}
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

// ------------------------------------------------------------------ side-by-side

function SideBySide({ scene, language }: { scene: { id: string; title: string; screenplay?: string | null }; language: string }) {
  const { data: translations, refetch: refetchTranslations } = useTranslationList(scene.id)
  const mutations = useTranslationMutations()
  const transition = useTranslationTransition()
  const audit = useTranslationAudit(scene.id, language)

  const existing = (translations ?? []).find((t) => t.language === language) ?? null
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<TranslationStatus>('DRAFT')
  const [reviewComment, setReviewComment] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [transitioning, setTransitioning] = useState(false)

  useEffect(() => {
    setDraft(existing?.screenplay ?? '')
    setStatus(existing?.status ?? 'DRAFT')
    setReviewComment(existing?.reviewerComment ?? '')
  }, [existing?.id, existing?.screenplay, existing?.status, existing?.reviewerComment, language, scene.id])

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

  const doTransition = (toStatus: TranslationStatus) => {
    if (!existing) return
    setTransitioning(true)
    transition.mutate(
      {
        sceneId: scene.id,
        language,
        fromStatus: existing.status,
        toStatus,
        comment: reviewComment || undefined,
      },
      {
        onSuccess: (r) => {
          setTransitioning(false)
          if (r.ok) {
            toast({ kind: 'success', title: `Status → ${toStatus}` })
            void refetchTranslations()
          } else {
            toast({ kind: 'error', title: 'Transition blocked', description: r.reason })
          }
        },
        onError: () => {
          setTransitioning(false)
          toast({ kind: 'error', title: 'Transition failed' })
        },
      },
    )
  }

  return (
    <div className="rounded-lg border border-mirai-border bg-mirai-panel/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone="accent">{language}</Badge>
        <span className="text-xs font-semibold text-mirai-text">{scene.title}</span>
        {existing && (
          <>
            <Badge
              tone={
                existing.status === 'FINAL'
                  ? 'success'
                  : existing.status === 'APPROVED'
                  ? 'accent'
                  : 'info'
              }
            >
              {existing.status}
            </Badge>
            {existing.isStale && <Badge tone="warn">stale</Badge>}
            {existing.reviewedBy && (
              <span className="text-[10px] text-mirai-faint">by {existing.reviewedBy.slice(-6)}</span>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {existing ? (
            <div className="flex items-center gap-1">
              <Label htmlFor="sb-status" className="text-[10px] text-mirai-faint mb-0">
                status
              </Label>
              <Select
                id="sb-status"
                className="h-7 w-32 text-[10px]"
                value={status}
                onChange={(e) => setStatus(e.target.value as TranslationStatus)}
              >
                {(['DRAFT', 'REVIEW', 'APPROVED', 'FINAL'] as TranslationStatus[]).map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </Select>
              <Label htmlFor="sb-comment" className="text-[10px] text-mirai-faint mb-0 ml-1">
                comment
              </Label>
              <Input
                id="sb-comment"
                className="h-7 w-40 text-[10px]"
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder="review note…"
              />
            </div>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            title={`Delete the ${language} translation`}
            onClick={() => setConfirmDelete(true)}
            disabled={transitioning}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {/* Transition buttons */}
          {existing && (
            <>
              {status === 'DRAFT' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => doTransition('REVIEW')}
                  disabled={transitioning}
                  title="Submit for review"
                >
                  submit review
                </Button>
              )}
              {status === 'REVIEW' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => doTransition('APPROVED')}
                    disabled={transitioning}
                    title="Approve translation"
                  >
                    approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => doTransition('DRAFT')}
                    disabled={transitioning}
                    title="Return to draft"
                  >
                    back to draft
                  </Button>
                </>
              )}
              {status === 'APPROVED' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => doTransition('FINAL')}
                    disabled={transitioning}
                    title="Finalize translation"
                  >
                    finalize
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => doTransition('REVIEW')}
                    disabled={transitioning}
                    title="Return to review"
                  >
                    back to review
                  </Button>
                </>
              )}
              {status === 'FINAL' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => doTransition('REVIEW')}
                  disabled={transitioning}
                  title="Reopen for review"
                >
                  reopen review
                </Button>
              )}
            </>
          )}
          {existing && dirty && (
            <Button
              size="sm"
              variant="primary"
              disabled={!dirty || draft.trim().length === 0 || transitioning}
              loading={mutations.upsert.isPending || transitioning}
              onClick={save}
            >
              <Save className="h-3.5 w-3.5" /> save
            </Button>
          )}
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

      {/* --------------------------------------------------- audit trail */}
      {existing && audit.data && audit.data.length > 0 && (
        <div className="mt-4 rounded-lg border border-mirai-border/50 bg-mirai-bg/30 p-3">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-mirai-faint mb-2">
            audit trail
          </h4>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {audit.data.map((a) => (
              <div key={a.id} className="flex items-start gap-2 px-2 py-1.5 rounded bg-mirai-border/40">
                <span className="text-[10px] text-mirai-faint">
                  {new Date(a.changedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <span className="text-xs text-mirai-text">
                  {a.oldStatus ?? '—'} →{' '}
                  <span className={`font-semibold ${STATUS_COLOR[a.newStatus] as string}`}>
                    {a.newStatus}
                  </span>
                </span>
                {a.comment && <span className="text-[10px] text-mirai-faint">— "{a.comment}"</span>}
                {a.changedBy && <span className="text-[10px] text-mirai-faint">by {a.changedBy.slice(-6)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

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

// -------------------------------------------------------------------- glossary

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

// -------------------------------------------------------------------- matrix

function TranslationMatrixPanel({ episodeId, matrixEntries }: { episodeId: string; matrixEntries: Array<{ id: string; title: string }> }) {
  const { data: matrix, isLoading } = useTranslationMatrix(episodeId)

  if (isLoading) return <SkeletonList rows={4} />
  if (!matrix?.entries) return null

  const scenes = matrixEntries

  return (
    <div className="mt-6 rounded-lg border border-mirai-border bg-mirai-panel/40 p-4">
      <h2 className="mb-3 font-display text-[11px] font-bold tracking-[0.16em] text-mirai-text uppercase">
        scenes × languages matrix
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr>
              <th className="text-left text-[10px] font-semibold text-mirai-faint pb-2">scene</th>
              {matrix.languages.map((lang) => (
                <th key={lang} className="text-center text-[10px] font-semibold text-mirai-faint pb-2">
                  {lang}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scenes.map((scene) => {
              const row = matrix.entries.filter((e) => e.sceneId === scene.id)
              return (
                <tr key={scene.id} className="border-b border-mirai-border/40">
                  <td className="py-2 text-[10px] text-mirai-text truncate max-w-[120px]">{scene.title}</td>
                  {matrix.languages.map((lang) => {
                    const cell = row.find((e) => e.language === lang)
                    return (
                      <td key={lang} className="text-center py-2">
                        {cell ? (
                          <Badge
                            tone={
                              cell.status === 'FINAL'
                                ? 'success'
                                : cell.status === 'APPROVED'
                                ? 'accent'
                                : cell.status === 'REVIEW'
                                ? 'warn'
                                : 'info'
                            }
                            className={`text-[10px] ${cell.isStale ? 'ring-1 ring-mirai-warn' : ''}`}
                          >
                            {cell.status}
                            {cell.isStale && ' ⚠'}
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-mirai-faint">—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
