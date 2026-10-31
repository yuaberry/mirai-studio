/**
 * Manga Studio (§8 of the expansion roadmap — slice 1):
 * pages, panels and lettering as data. Chapters reuse the episodes of
 * the project; every page belongs to an episode, every panel belongs to
 * a page, and every bubble (speech, thought, SFX, caption…) is a typed
 * record — the lettering script export works from this exact data.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  FileImage,
  ImagePlus,
  LayoutGrid,
  MessageSquarePlus,
  Package,
  Plus,
  Save,
  Trash2,
  Wand2,
} from 'lucide-react'
import {
  BUBBLE_KINDS,
  BUBBLE_TAILS,
  MiraiError,
  READING_DIRECTIONS,
  type BubbleKind,
  type BubbleTail,
  type CharacterRecord,
  type EpisodeWithStats,
  type MangaPageRecord,
  type MangaPanelRecord,
  type ReadingDirection,
  type ShotRecord,
} from '@mirai/shared'
import { Badge, Button, Label, Select, Spinner, Textarea } from '../../system/ui'
import { EmptyState, ErrorState } from '../../system/EmptyState'
import { SkeletonList } from '../../system/Skeleton'
import { ConfirmModal } from '../../system/Modal'
import {
  useEpisodes,
  useScenes,
  useCharacters,
  useMangaPages,
  useMangaPageMutations,
  useMangaPanels,
  useMangaPanelMutations,
  useMangaScriptExport,
  useMangaRevealScript,
  useMangaPackageExport,
  useMangaRevealPackage,
  useMangaProofsExport,
  useMangaAutoBoard,
  usePanelLetteringDraft,
} from '../../lib/queries'
import { PageCanvas } from './PageCanvas'
import { invoke } from '../../lib/ipc'
import { toast } from '../../store/appStore'
import { T } from '../../system/T'

interface BubbleDraft {
  kind: BubbleKind
  characterId?: string
  text: string
  x: number
  y: number
  width: number
  tail: BubbleTail
}

const BUBBLE_KIND_LABEL: Record<BubbleKind, string> = {
  SPEECH: 'Speech',
  THOUGHT: 'Thought',
  SHOUT: 'Shout',
  WHISPER: 'Whisper',
  NARRATION: 'Narration',
  SFX: 'SFX',
  CAPTION: 'Caption',
}

function panelToDraft(panel: MangaPanelRecord): BubbleDraft[] {
  return panel.lettering.map((b) => ({
    kind: b.kind,
    characterId: b.characterId,
    text: b.text,
    x: b.x,
    y: b.y,
    width: b.width,
    tail: b.tail,
  }))
}

export function MangaStudioPage() {
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null)
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [pageToDelete, setPageToDelete] = useState<MangaPageRecord | null>(null)
  const [panelToDelete, setPanelToDelete] = useState<MangaPanelRecord | null>(null)

  const { data: episodes, isLoading: episodesLoading, isError: episodesError, error: episodesErr, refetch: refetchEpisodes } = useEpisodes()
  const { data: pages, isLoading: pagesLoading, isError: pagesError, error: pagesErr, refetch: refetchPages } = useMangaPages(selectedEpisodeId)
  const pageMutations = useMangaPageMutations()
  const panelMutations = useMangaPanelMutations()
  const scriptExport = useMangaScriptExport()
  const revealScript = useMangaRevealScript()
  const packageExport = useMangaPackageExport()
  const revealPackage = useMangaRevealPackage()
  const proofsExport = useMangaProofsExport()
  const autoBoard = useMangaAutoBoard()

  const selectedEpisode = useMemo(
    () => (episodes ?? []).find((e) => e.id === selectedEpisodeId) ?? null,
    [episodes, selectedEpisodeId],
  )
  const selectedPage = useMemo(
    () => (pages ?? []).find((p) => p.id === selectedPageId) ?? null,
    [pages, selectedPageId],
  )

  useEffect(() => {
    if (!selectedEpisodeId && episodes && episodes.length > 0) {
      setSelectedEpisodeId(episodes[0]!.id)
    }
  }, [episodes, selectedEpisodeId])

  useEffect(() => {
    if (pages && pages.length > 0 && !(pages ?? []).some((p) => p.id === selectedPageId)) {
      setSelectedPageId(pages[0]!.id)
    }
    if (pages && pages.length === 0) setSelectedPageId(null)
  }, [pages, selectedPageId])

  if (episodesLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }
  if (episodesError) {
    return (
      <ErrorState
        title="Episodes failed to load"
        message={episodesErr instanceof MiraiError ? episodesErr.message : 'Unknown error'}
        onRetry={() => void refetchEpisodes()}
      />
    )
  }
  if ((episodes ?? []).length === 0) {
    return (
      <EmptyState
        icon={<BookOpen className="h-5 w-5" />}
        title="No chapters to draw yet"
        description="Create an episode in Episodes & Scenes first — every episode is also a manga chapter."
      />
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ------------------------------------------------ chapter (episode) list */}
      <div className="flex w-56 shrink-0 flex-col border-r border-mirai-border px-4 py-6">
        <h1 className="mb-3 font-display text-sm font-bold text-mirai-text">
          <T k="Manga Studio" />
        </h1>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto">
          <ul className="space-y-0.5">
            {(episodes ?? []).map((episode) => (
              <li key={episode.id}>
                <button
                  onClick={() => setSelectedEpisodeId(episode.id)}
                  className={`w-full rounded-md px-2.5 py-2 text-left transition-colors ${
                    episode.id === selectedEpisodeId
                      ? 'bg-mirai-hover text-mirai-text'
                      : 'text-mirai-dim hover:bg-mirai-hover/60 hover:text-mirai-text'
                  }`}
                >
                  <p className="text-xs font-semibold">S{episode.season}E{episode.number}</p>
                  <p className="truncate text-[11px] text-mirai-faint">{episode.title}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ---------------------------------------------------------- page column */}
      <div className="flex w-64 shrink-0 flex-col border-r border-mirai-border px-4 py-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-mirai-text">
            <T k="Pages" />
          </h2>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              loading={scriptExport.isPending}
              title="Export the professional lettering script for this chapter"
              onClick={() => {
                if (!selectedEpisodeId) return
                scriptExport.mutate(selectedEpisodeId, {
                  onSuccess: (r) =>
                    toast({
                      kind: 'success',
                      title: 'Lettering script exported',
                      description: `${r.pages} pages, ${r.bubbles} bubbles — ${r.path}`,
                    }),
                  onError: (err) =>
                    toast({ kind: 'error', title: 'Export failed', description: err.message }),
                })
              }}
            >
              <BookOpen className="h-3.5 w-3.5" /> <T k="Script" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="Reveal the lettering script in the file manager"
              onClick={() => {
                if (!selectedEpisodeId) return
                revealScript.mutate(selectedEpisodeId, {
                  onError: (err) =>
                    toast({ kind: 'error', title: 'Reveal failed', description: err.message }),
                })
              }}
            >
              ↗
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="Reveal the chapter proof package in the file manager"
              onClick={() => {
                if (!selectedEpisodeId) return
                revealPackage.mutate(selectedEpisodeId, {
                  onError: (err) =>
                    toast({ kind: 'error', title: 'Reveal failed', description: err.message }),
                })
              }}
            >
              📦↗
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={packageExport.isPending}
              title="SVG page proofs + lettering script, zipped per chapter"
              onClick={() => {
                if (!selectedEpisodeId) return
                packageExport.mutate(selectedEpisodeId, {
                  onSuccess: (r) =>
                    toast({
                      kind: 'success',
                      title: 'Chapter package exported',
                      description: `${r.pages} page proofs, ${r.bubbles} bubbles — ${r.path}`,
                    }),
                  onError: (err) =>
                    toast({ kind: 'error', title: 'Package export failed', description: err.message }),
                })
              }}
            >
              <Package className="h-3.5 w-3.5" /> <T k="Proofs" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={proofsExport.isPending}
              title="Render page proofs to PNG and/or PDF per chapter"
              onClick={() => {
                if (!selectedEpisodeId) return
                proofsExport.mutate(
                  { episodeId: selectedEpisodeId, format: 'both' },
                  {
                    onSuccess: (r) =>
                      toast({
                        kind: 'success',
                        title: 'Page proofs exported',
                        description: `${r.pages} pages, ${r.format} — ${r.path}`,
                      }),
                    onError: (err) =>
                      toast({ kind: 'error', title: 'Proofs export failed', description: err.message }),
                  },
                )
              }}
            >
              <FileImage className="h-3.5 w-3.5" /> <T k="Proofs PNG/PDF" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={autoBoard.isPending}
              title="Auto-board: create manga pages from this chapter's storyboard shots"
              onClick={() => {
                if (!selectedEpisodeId) return
                autoBoard.mutate(
                  { episodeId: selectedEpisodeId, panelsPerPage: 4 },
                  {
                    onSuccess: (r) =>
                      toast({
                        kind: 'success',
                        title: 'Chapter auto-boarded',
                        description: `${r.pages} pages, ${r.panels} panels from storyboard shots`,
                      }),
                    onError: (err) =>
                      toast({ kind: 'error', title: 'Auto-board failed', description: err.message }),
                  },
                )
              }}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> <T k="Auto-board" />
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!selectedEpisodeId}
              loading={pageMutations.create.isPending}
              onClick={() => {
                if (!selectedEpisodeId) return
                pageMutations.create.mutate(
                  { episodeId: selectedEpisodeId, input: { readingDirection: 'RTL' } },
                  {
                    onSuccess: (page) => setSelectedPageId(page.id),
                    onError: (err) =>
                      toast({ kind: 'error', title: 'Page creation failed', description: err.message }),
                  },
                )
              }}
            >
              <Plus className="h-3.5 w-3.5" /> <T k="New page" />
            </Button>
          </div>
        </div>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto">
          {pagesLoading ? (
            <SkeletonList rows={4} />
          ) : pagesError ? (
            <ErrorState
              title="Pages failed to load"
              message={pagesErr instanceof MiraiError ? pagesErr.message : 'Unknown error'}
              onRetry={() => void refetchPages()}
            />
          ) : (pages ?? []).length === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-5 w-5" />}
              title="No pages yet"
              description="Every chapter starts with page 1."
              className="min-h-40"
            />
          ) : (
            <ul className="space-y-0.5">
              {(pages ?? []).map((page) => (
                <li key={page.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => setSelectedPageId(page.id)}
                    className={`flex-1 rounded-md px-2.5 py-2 text-left transition-colors ${
                      page.id === selectedPageId
                        ? 'bg-mirai-hover text-mirai-text'
                        : 'text-mirai-dim hover:bg-mirai-hover/60 hover:text-mirai-text'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold">
                        <T k="Page" /> {page.number}
                      </p>
                      <Badge tone={page.readingDirection === 'RTL' ? 'accent' : 'info'}>
                        {page.readingDirection === 'RTL' ? 'RTL' : 'LTR'}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-mirai-faint">
                      {page.panelCount} panel{page.panelCount === 1 ? '' : 's'}
                    </p>
                  </button>
                  <div className="flex flex-col">
                    <button
                      className="rounded p-0.5 text-mirai-faint hover:text-mirai-text"
                      title="Move page up"
                      onClick={() =>
                        pageMutations.move.mutate(
                          { id: page.id, direction: 'up', episodeId: page.episodeId },
                          { onError: () => toast({ kind: 'error', title: 'Page already first' }) },
                        )
                      }
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      className="rounded p-0.5 text-mirai-faint hover:text-mirai-text"
                      title="Move page down"
                      onClick={() =>
                        pageMutations.move.mutate(
                          { id: page.id, direction: 'down', episodeId: page.episodeId },
                          { onError: () => toast({ kind: 'error', title: 'Page already last' }) },
                        )
                      }
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                  </div>
                  <button
                    className="rounded p-1 text-mirai-faint opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                    title="Delete page"
                    onClick={() => setPageToDelete(page)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------- page editor */}
      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
        {selectedPage ? (
          <PageEditor
            key={selectedPage.id}
            page={selectedPage}
            episode={selectedEpisode}
            panelMutations={panelMutations}
            onDeletePanel={setPanelToDelete}
          />
        ) : (
          <EmptyState
            icon={<BookOpen className="h-5 w-5" />}
            title="Select a page"
            description="Or create the first page of this chapter."
            className="min-h-64"
          />
        )}
      </div>

      <ConfirmModal
        open={pageToDelete !== null}
        title={`Delete page ${pageToDelete?.number ?? ''}?`}
        description="Its panels and lettering go with it. This cannot be undone."
        danger
        onConfirm={() => {
          if (!pageToDelete) return
          pageMutations.remove.mutate(
            { id: pageToDelete.id, episodeId: pageToDelete.episodeId },
            {
              onSuccess: () => toast({ kind: 'success', title: 'Page deleted' }),
              onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }),
            },
          )
          setPageToDelete(null)
        }}
        onClose={() => setPageToDelete(null)}
      />
      <ConfirmModal
        open={panelToDelete !== null}
        title="Delete panel?"
        description="Its lettering and the attached image (if unreferenced) go with it."
        danger
        onConfirm={() => {
          if (!panelToDelete) return
          panelMutations.remove.mutate(
            { id: panelToDelete.id, pageId: panelToDelete.pageId },
            {
              onSuccess: () => toast({ kind: 'success', title: 'Panel deleted' }),
              onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }),
            },
          )
          setPanelToDelete(null)
        }}
        onClose={() => setPanelToDelete(null)}
      />
    </div>
  )
}

// ---------------------------------------------------------------- page editor

function PageEditor(props: {
  page: MangaPageRecord
  episode: EpisodeWithStats | null
  panelMutations: ReturnType<typeof useMangaPanelMutations>
  onDeletePanel: (panel: MangaPanelRecord) => void
}) {
  const { page, episode, panelMutations, onDeletePanel } = props
  const { data: panels, isLoading, isError, error, refetch } = useMangaPanels(page.id)
  const { data: characters } = useCharacters()
  const { data: scenes } = useScenes(page.episodeId)

  const [direction, setDirection] = useState<ReadingDirection>(page.readingDirection)
  const [notes, setNotes] = useState(page.layoutNotes ?? '')
  const [savingPage, setSavingPage] = useState(false)

  const pageMutations = useMangaPageMutations()

  // Shots of this chapter (for the optional panel → shot reference link).
  const shotsByScene = useQuery({
    queryKey: ['manga', 'chapterShots', page.episodeId],
    enabled: (scenes ?? []).length > 0,
    queryFn: async () => {
      const results: ShotRecord[] = []
      for (const scene of scenes ?? []) {
        const r = await invoke('shots:list', { sceneId: scene.id })
        results.push(...r.shots)
      }
      return results
    },
    staleTime: 60_000,
  })

  const ordered = panels ?? []
  const display = page.readingDirection === 'RTL' ? [...ordered].reverse() : ordered

  const savePage = () => {
    setSavingPage(true)
    pageMutations.update.mutate(
      { id: page.id, input: { readingDirection: direction, layoutNotes: notes || undefined } },
      {
        onSettled: () => setSavingPage(false),
        onSuccess: () => toast({ kind: 'success', title: 'Page saved' }),
        onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
      },
    )
  }

  const rtl = page.readingDirection === 'RTL'

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>
            <T k="Page" /> {page.number}
            <span className="ml-2 font-normal text-mirai-faint">
              {episode ? `S${episode.season}E${episode.number} — ${episode.title}` : ''}
            </span>
          </Label>
        </div>
        <div>
          <Label htmlFor="mg-dir">Reading direction</Label>
          <Select
            id="mg-dir"
            className="h-8 w-40 text-xs"
            value={direction}
            onChange={(e) => setDirection(e.target.value as ReadingDirection)}
          >
            {READING_DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {d === 'RTL' ? 'Right-to-left (manga)' : 'Left-to-right'}
              </option>
            ))}
          </Select>
        </div>
        <Button size="sm" variant="outline" loading={savingPage} onClick={savePage}>
          <Save className="h-3.5 w-3.5" /> <T k="Save" />
        </Button>
        <div className="ml-auto">
          <Badge tone="accent">
            {rtl ? '↤ reads right-to-left' : '↦ reads left-to-right'}
          </Badge>
        </div>
      </div>

      <div>
        <Label htmlFor="mg-notes">Layout notes</Label>
        <Textarea
          id="mg-notes"
          rows={2}
          data-selectable="true"
          className="text-xs"
          placeholder="Bleed margins, spread hints, double-page moments…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* ------------------------------------------------------- page canvas */}
      {!isLoading && !isError ? (
        <PageCanvas
          page={page}
          panels={panels ?? []}
          rtl={page.readingDirection === 'RTL'}
          onCommit={(panel, coords) => {
            panelMutations.update.mutate(
              {
                id: panel.id,
                input: {
                  shotId: panel.shotId,
                  lettering: panel.lettering.map((b) => ({
                    kind: b.kind,
                    characterId: b.characterId,
                    text: b.text,
                    x: b.x,
                    y: b.y,
                    width: b.width,
                    tail: b.tail,
                  })),
                  coords,
                },
              },
              {
                onError: (err) =>
                  toast({ kind: 'error', title: 'Layout save failed', description: err.message }),
              },
            )
          }}
        />
      ) : null}

      {/* -------------------------------------------------------- panel strip */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner className="h-4 w-4" />
          </div>
        ) : isError ? (
          <ErrorState
            title="Panels failed to load"
            message={error instanceof MiraiError ? error.message : 'Unknown error'}
            onRetry={() => void refetch()}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2" style={rtl ? { direction: 'rtl' } : undefined}>
            {display.map((panel) => (
              <div key={panel.id} style={rtl ? { direction: 'ltr' } : undefined}>
                <PanelCard
                  panel={panel}
                  readingOrder={panel.orderIndex + 1}
                  characters={characters ?? []}
                  shots={shotsByScene.data ?? []}
                  panelMutations={panelMutations}
                  onDelete={() => onDeletePanel(panel)}
                />
              </div>
            ))}
          </div>
        )}

        <Button
          size="sm"
          variant="primary"
          loading={panelMutations.create.isPending}
          onClick={() =>
            panelMutations.create.mutate(
              { pageId: page.id, input: {} },
              {
                onError: (err) =>
                  toast({ kind: 'error', title: 'Panel creation failed', description: err.message }),
              },
            )
          }
        >
          <Plus className="h-3.5 w-3.5" /> <T k="Add panel" />
        </Button>
      </div>
    </div>
  )
}

// --------------------------------------------------------------- panel editor

function PanelCard(props: {
  panel: MangaPanelRecord
  readingOrder: number
  characters: CharacterRecord[]
  shots: ShotRecord[]
  panelMutations: ReturnType<typeof useMangaPanelMutations>
  onDelete: () => void
}) {
  const { panel, readingOrder, characters, shots, panelMutations, onDelete } = props
  const [shotId, setShotId] = useState(panel.shotId ?? '')
  const [bubbles, setBubbles] = useState<BubbleDraft[]>(() => panelToDraft(panel))
  const [dirty, setDirty] = useState(false)
  const aiDraft = usePanelLetteringDraft()

  useEffect(() => {
    setShotId(panel.shotId ?? '')
  }, [panel.shotId])

  useEffect(() => {
    if (!dirty) setBubbles(panelToDraft(panel))
  }, [panel, dirty])

  const shot = shots.find((s) => s.id === shotId)

  const save = () => {
    panelMutations.update.mutate(
      {
        id: panel.id,
        input: {
          shotId: shotId || undefined,
          lettering: bubbles
            .filter((b) => b.text.trim().length > 0)
            .map((b, i) => ({ ...b, orderIndex: i })),
        },
      },
      {
        onSuccess: () => {
          setDirty(false)
          toast({ kind: 'success', title: 'Panel saved' })
        },
        onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
      },
    )
  }

  return (
    <div className="rounded-lg border border-mirai-border bg-mirai-panel/60 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone="accent">Panel {readingOrder}</Badge>
        <div className="flex gap-0.5">
          <button
            className="rounded p-1 text-mirai-faint hover:text-mirai-text"
            title="Move panel earlier in reading order"
            onClick={() =>
              panelMutations.move.mutate(
                { id: panel.id, direction: 'up', pageId: panel.pageId },
                { onError: () => toast({ kind: 'error', title: 'Panel already first' }) },
              )
            }
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            className="rounded p-1 text-mirai-faint hover:text-mirai-text"
            title="Move panel later in reading order"
            onClick={() =>
              panelMutations.move.mutate(
                { id: panel.id, direction: 'down', pageId: panel.pageId },
                { onError: () => toast({ kind: 'error', title: 'Panel already last' }) },
              )
            }
          >
            <ArrowDown className="h-3 w-3" />
          </button>
          <button
            className="rounded p-1 text-mirai-faint hover:text-red-400"
            title="Delete panel"
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {panel.imageAssetId ? (
            <img
              src={`mirai-asset://${panel.imageAssetId}/`}
              alt={`Panel ${readingOrder} art`}
              className="max-h-32 rounded border border-mirai-border-strong"
            />
          ) : (
            <Button
              size="sm"
              variant="outline"
              loading={panelMutations.attachImage.isPending}
              title="Import real panel art (png/jpg/webp/gif)"
              onClick={() =>
                panelMutations.attachImage.mutate(
                  { id: panel.id, pageId: panel.pageId },
                  {
                    onSuccess: (updated) =>
                      updated.imageAssetId
                        ? toast({ kind: 'success', title: 'Panel art attached' })
                        : undefined,
                    onError: (err) => {
                      if (err instanceof MiraiError && err.code === 'CANCELLED') return
                      toast({ kind: 'error', title: 'Import failed', description: err.message })
                    },
                  },
                )
              }
            >
              <ImagePlus className="h-3.5 w-3.5" /> <T k="Panel art" />
            </Button>
          )}
        </div>
      </div>

      <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`pn-shot-${panel.id}`} className="text-[11px]">
            Shot reference <span className="font-normal text-mirai-faint">storyboard link</span>
          </Label>
          <Select
            id={`pn-shot-${panel.id}`}
            className="h-8 text-xs"
            value={shotId}
            onChange={(e) => {
              setShotId(e.target.value)
              setDirty(true)
            }}
          >
            <option value="">— none —</option>
            {(shots.length > 0 ? shots : []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({s.shotType.toLowerCase().replace(/_/g, ' ')})
              </option>
            ))}
          </Select>
          {shot ? (
            <p className="mt-0.5 text-[10px] text-mirai-faint">
              {shot.durationSeconds}s · {shot.cameraMovement.toLowerCase().replace(/_/g, ' ')}
            </p>
          ) : null}
        </div>
      </div>

      {/* ------------------------------------------------------- lettering */}
      <div className="space-y-2">
        {bubbles.map((bubble, i) => (
          <div key={i} className="rounded border border-mirai-border/70 bg-mirai-bg/40 p-2">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <Select
                className="h-7 w-28 text-[11px]"
                value={bubble.kind}
                onChange={(e) => {
                  setBubbles((bs) => bs.map((b, j) => (j === i ? { ...b, kind: e.target.value as BubbleKind } : b)))
                  setDirty(true)
                }}
              >
                {BUBBLE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {BUBBLE_KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
              {bubble.kind !== 'SFX' && bubble.kind !== 'NARRATION' && bubble.kind !== 'CAPTION' ? (
                <Select
                  className="h-7 max-w-40 text-[11px]"
                  value={bubble.characterId ?? ''}
                  onChange={(e) => {
                    setBubbles((bs) => bs.map((b, j) => (j === i ? { ...b, characterId: e.target.value || undefined } : b)))
                    setDirty(true)
                  }}
                >
                  <option value="">unattributed</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              ) : null}
              <Select
                className="h-7 w-36 text-[11px]"
                value={bubble.tail}
                onChange={(e) => {
                  setBubbles((bs) => bs.map((b, j) => (j === i ? { ...b, tail: e.target.value as BubbleTail } : b)))
                  setDirty(true)
                }}
              >
                {BUBBLE_TAILS.map((t) => (
                  <option key={t} value={t}>
                    tail: {t.toLowerCase().replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
              <button
                className="ml-auto rounded p-1 text-mirai-faint hover:text-red-400"
                title="Remove bubble"
                onClick={() => {
                  setBubbles((bs) => bs.filter((_, j) => j !== i))
                  setDirty(true)
                }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <Textarea
              rows={2}
              data-selectable="true"
              className="text-xs"
              placeholder={
                bubble.kind === 'SFX'
                  ? 'DOON! — stylized onomatopoeia'
                  : bubble.kind === 'CAPTION' || bubble.kind === 'NARRATION'
                    ? 'Meanwhile, at the shrine…'
                    : 'Write the dialogue line…'
              }
              value={bubble.text}
              onChange={(e) => {
                setBubbles((bs) => bs.map((b, j) => (j === i ? { ...b, text: e.target.value } : b)))
                setDirty(true)
              }}
            />
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-mirai-faint">
              <label className="flex items-center gap-1">
                x
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={bubble.x}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setBubbles((bs) => bs.map((b, j) => (j === i ? { ...b, x: v } : b)))
                    setDirty(true)
                  }}
                />
                {bubble.x.toFixed(2)}
              </label>
              <label className="flex items-center gap-1">
                y
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={bubble.y}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setBubbles((bs) => bs.map((b, j) => (j === i ? { ...b, y: v } : b)))
                    setDirty(true)
                  }}
                />
                {bubble.y.toFixed(2)}
              </label>
              <label className="flex items-center gap-1">
                w
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={bubble.width}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setBubbles((bs) => bs.map((b, j) => (j === i ? { ...b, width: v } : b)))
                    setDirty(true)
                  }}
                />
                {bubble.width.toFixed(2)}
              </label>
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setBubbles((bs) => [...bs, { kind: 'SPEECH', text: '', x: 0.5, y: 0.5, width: 0.35, tail: 'BOTTOM_LEFT' }])
              setDirty(true)
            }}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" /> <T k="Add bubble" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!shotId}
            loading={aiDraft.isPending}
            title={shotId ? 'AI drafts lettering from the linked shot\'s screenplay — you review before saving' : 'Link a storyboard shot first'}
            onClick={() =>
              aiDraft.mutate(panel.id, {
                onSuccess: (r) => {
                  setBubbles(
                    r.bubbles.map((b, i) => ({
                      kind: b.kind,
                      characterId: b.characterId,
                      text: b.text,
                      x: 0.3 + ((i * 0.25) % 0.45),
                      y: 0.15 + i * 0.18,
                      width: 0.35,
                      tail: b.tail,
                    })),
                  )
                  setDirty(true)
                  toast({
                    kind: 'success',
                    title: 'Lettering drafted',
                    description: `${r.bubbles.length} bubbles — review and save.`,
                  })
                },
                onError: (err) =>
                  toast({ kind: 'error', title: 'AI draft failed', description: err.message }),
              })
            }
          >
            <Wand2 className="h-3.5 w-3.5" /> <T k="AI lettering" />
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty}
            loading={panelMutations.update.isPending}
            onClick={save}
          >
            <Save className="h-3.5 w-3.5" /> <T k="Save panel" />
          </Button>
        </div>
      </div>
    </div>
  )
}
