/**
 * Prompt Library — the manga/anime generation toolbox (spec §21/§31).
 * Built-in curated prompts ship with every project; users create, tune,
 * copy and send them to the AI Assist. Mangá-first.
 */
import { useEffect, useMemo, useState } from 'react'
import { Copy, Pencil, Plus, Search, Sparkles, Trash2, Wand2 } from 'lucide-react'
import {
  MiraiError,
  PROMPT_CATEGORIES,
  PROMPT_CATEGORY_LABEL,
  promptTags,
  type PromptCategory,
  type PromptRecord,
} from '@mirai/shared'
import { Badge, Button, Input, Label, Select, Spinner, Textarea } from '../../system/ui'
import { usePlugins, useSettings } from '../../lib/queries'
import { MATURE_PROMPT_PACK } from '@mirai/shared'
import { EmptyState, ErrorState } from '../../system/EmptyState'
import { ConfirmModal, Modal } from '../../system/Modal'
import { copyText, usePromptMutations, usePrompts } from '../../lib/queries'
import { useAppStore, toast } from '../../store/appStore'

export function PromptLibraryPage() {
  const { data: prompts, isLoading, isError, error, refetch } = usePrompts()
  // Plugin-contributed prompts (SUGGEST capability) — merged read-only.
  // Pro mature pack — merged only while Mature Content Mode is on.
  const { data: settingsData } = useSettings()
  const matureOn = settingsData?.content?.matureEnabled ?? false
  const { data: pluginRecords } = usePlugins()
  const pluginPrompts = (pluginRecords ?? [])
    .filter((pl) => pl.enabled && pl.errors.length === 0)
    .flatMap((pl) =>
      pl.manifest.prompts.map((pr) => ({
        id: `${pl.manifest.id}:${pr.title}`,
        category: pr.category,
        title: pr.title,
        body: pr.body,
        tags: pr.tags,
        builtin: false,
        plugin: pl.manifest.name,
        createdAt: '',
        updatedAt: '',
      })),
    )
  const mutations = usePromptMutations()
  const [category, setCategory] = useState<'ALL' | PromptCategory>('ALL')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<PromptRecord | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<PromptRecord | null>(null)
  const setView = useAppStore((s) => s.setView)
  const setAssistSeed = useAppStore((s) => s.setAssistSeed)

  const filtered = useMemo(() => {
    let list: Array<(typeof pluginPrompts)[number] | import('@mirai/shared').PromptRecord> = [
      ...(prompts ?? []),
      ...pluginPrompts,
      ...(matureOn
        ? MATURE_PROMPT_PACK.map((mp) => ({
            id: `mature:${mp.title}`,
            category: mp.category,
            title: mp.title,
            body: mp.body,
            tags: mp.tags,
            builtin: false,
            mature: true,
            createdAt: '',
            updatedAt: '',
          }))
        : []),
    ]
    if (category !== 'ALL') list = list.filter((p) => p.category === category)
    if (search.trim()) {
      const needle = search.trim().toLowerCase()
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(needle) ||
          p.body.toLowerCase().includes(needle) ||
          promptTags(p).some((t) => t.includes(needle)),
      )
    }
    return list
  }, [prompts, pluginPrompts, matureOn, category, search])

  const sendToAssist = (prompt: PromptRecord) => {
    setAssistSeed(prompt.body)
    setView('assist')
  }

  const copy = (prompt: PromptRecord) => {
    void copyText(prompt.body).then(() =>
      toast({ kind: 'success', title: 'Prompt copied to clipboard' }),
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-mirai-text">Prompt Library</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mirai-dim">
            The studio's generation toolbox — manga panels, character sheets, anime keyframes,
            style anchors and negatives. Built-ins are curated craft prompts; edit them to make
            them yours, then copy or send straight to AI Assist.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New Prompt
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <CategoryChip active={category === 'ALL'} onClick={() => setCategory('ALL')}>
          All ({(prompts ?? []).length})
        </CategoryChip>
        {PROMPT_CATEGORIES.map((cat) => {
          const count = (prompts ?? []).filter((p) => p.category === cat).length
          return (
            <CategoryChip key={cat} active={category === cat} onClick={() => setCategory(cat)}>
              {PROMPT_CATEGORY_LABEL[cat]} ({count})
            </CategoryChip>
          )
        })}
        <div className="relative ml-auto w-64">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-mirai-faint" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Search prompts, tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : isError ? (
        <ErrorState
          title="Prompt Library failed to load"
          message={error instanceof MiraiError ? error.message : 'Unknown error'}
          onRetry={() => void refetch()}
        />
      ) : filtered.length === 0 ? (
        <div className="panel border-dashed">
          <EmptyState
            icon={<Wand2 className="h-5 w-5" />}
            title={search || category !== 'ALL' ? 'No prompts match' : 'Library is empty'}
            description={
              search || category !== 'ALL'
                ? 'Try another filter.'
                : 'Create your first prompt — or reopen the project to seed the built-in manga library.'
            }
            className="min-h-40"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((prompt) => (
            <div
              key={prompt.id}
              className="panel group flex animate-in flex-col gap-3 p-4 transition-colors hover:border-mirai-accent-2/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={prompt.category === 'MANGA_PANEL' ? 'violet' : 'info'}>
                      {PROMPT_CATEGORY_LABEL[prompt.category]}
                    </Badge>
                    {prompt.builtin && <Badge tone="accent">Built-in</Badge>}
                    {'plugin' in prompt && Boolean(prompt.plugin) && <Badge tone="violet">plugin</Badge>}
                    {'mature' in prompt && Boolean(prompt.mature) && <Badge tone="danger">18+ Pro</Badge>}
                  </div>
                  <h3 className="mt-1.5 truncate font-display text-sm font-semibold text-mirai-text">
                    {prompt.title}
                  </h3>
                </div>
              </div>

              <p className="line-clamp-4 min-h-16 text-[11px] leading-relaxed whitespace-pre-line text-mirai-dim" data-selectable="true">
                {prompt.body}
              </p>

              {promptTags(prompt).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {promptTags(prompt).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-mirai-border bg-mirai-panel px-2 py-0.5 text-[10px] text-mirai-faint"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-auto flex items-center justify-between">
                <Button size="sm" variant="primary" onClick={() => sendToAssist(prompt)}>
                  <Sparkles className="h-3.5 w-3.5" /> Use in Assist
                </Button>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => copy(prompt)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(prompt)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {!prompt.builtin && (
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(prompt)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <PromptEditModal
        open={creating || editing !== null}
        prompt={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
      />

      <ConfirmModal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={`Delete “${confirmDelete?.title ?? ''}”?`}
        description="This prompt is removed from the library. Built-ins are protected from deletion."
        confirmLabel="Delete Prompt"
        danger
        busy={mutations.remove.isPending}
        onConfirm={() => {
          if (!confirmDelete) return
          mutations.remove.mutate(confirmDelete.id, {
            onSuccess: () => {
              setConfirmDelete(null)
              toast({ kind: 'success', title: 'Prompt deleted' })
            },
            onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }),
          })
        }}
      />
    </div>
  )
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? 'border-mirai-accent/40 bg-mirai-accent/15 text-mirai-accent'
          : 'border-mirai-border-strong bg-mirai-panel text-mirai-faint hover:text-mirai-dim'
      }`}
    >
      {children}
    </button>
  )
}

function PromptEditModal({
  open,
  prompt,
  onClose,
}: {
  open: boolean
  prompt: PromptRecord | null
  onClose: () => void
}) {
  const mutations = usePromptMutations()
  const [form, setForm] = useState({
    category: 'MANGA_PANEL' as PromptCategory,
    title: '',
    body: '',
    tags: '',
  })

  // Re-seed the form whenever the modal target changes (edit / new / switch).
  useEffect(() => {
    setForm(
      prompt
        ? { category: prompt.category, title: prompt.title, body: prompt.body, tags: prompt.tags ?? '' }
        : { category: 'MANGA_PANEL', title: '', body: '', tags: '' },
    )
  }, [prompt?.id, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!form.title.trim() || !form.body.trim()) {
      toast({ kind: 'warning', title: 'Title and body are required.' })
      return
    }
    const input = {
      category: form.category,
      title: form.title.trim(),
      body: form.body,
      tags: form.tags.trim() || undefined,
    }
    if (prompt) {
      mutations.update.mutate(
        { id: prompt.id, input },
        {
          onSuccess: () => {
            toast({ kind: 'success', title: 'Prompt updated' })
            onClose()
          },
          onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
        },
      )
    } else {
      mutations.create.mutate(input, {
        onSuccess: () => {
          toast({ kind: 'success', title: 'Prompt created' })
          onClose()
        },
        onError: (err) => toast({ kind: 'error', title: 'Create failed', description: err.message }),
      })
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={prompt ? `Edit “${prompt.title}”` : 'New Prompt'}
      description={prompt?.builtin ? 'Built-in prompt — your edits become a personal override.' : undefined}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={mutations.create.isPending || mutations.update.isPending}
            onClick={submit}
          >
            {prompt ? 'Save Prompt' : 'Create Prompt'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="pl-category">Category</Label>
          <Select
            id="pl-category"
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as PromptCategory }))}
          >
            {PROMPT_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {PROMPT_CATEGORY_LABEL[cat]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="pl-tags">Tags (comma separated)</Label>
          <Input
            id="pl-tags"
            placeholder="manga, panel, action"
            value={form.tags}
            onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
          />
        </div>
        <div className="col-span-2">
          <Label htmlFor="pl-title">Title</Label>
          <Input
            id="pl-title"
            value={form.title}
            placeholder="Manga Panel — Confession Under Rain"
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>
        <div className="col-span-2">
          <Label htmlFor="pl-body">
            Prompt body
            <span className="ml-2 font-normal text-mirai-faint">
              write it like a pro: subject, composition, style, mood
            </span>
          </Label>
          <Textarea
            id="pl-body"
            rows={12}
            data-selectable="true"
            className="font-mono text-xs leading-relaxed"
            placeholder={`A single manga panel, black-and-white screentone art.\nComposition: ...\nSubject: [DESCRIBE]\nInking: ...\nMood: ...`}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          />
        </div>
      </div>
    </Modal>
  )
}
