/**
 * Character Studio (Module 06) — master–detail cast editor.
 */
import { useMemo, useState } from 'react'
import { Plus, Search, Trash2, UserRound } from 'lucide-react'
import {
  ASSET_STATUSES,
  CHARACTER_ROLES,
  MiraiError,
  type AssetStatus,
  type CharacterRecord,
} from '@mirai/shared'
import { Badge, Button, Input, Label, Select, Spinner, Textarea } from '../../system/ui'
import { EmptyState, ErrorState } from '../../system/EmptyState'
import { ConfirmModal } from '../../system/Modal'
import { VersionHistoryButton, VersionHistoryModal } from '../production/VersionHistoryModal'
import { useCharacters, useCharacterMutations, useApprovalTransition } from '../../lib/queries'
import { toast } from '../../store/appStore'

const ROLE_LABEL: Record<string, string> = {
  PROTAGONIST: 'Protagonist',
  DEUTERAGONIST: 'Deuteragonist',
  SUPPORTING: 'Supporting',
  ANTAGONIST: 'Antagonist',
  CAMEO: 'Cameo',
  OTHER: 'Other',
}

export function CharactersPage() {
  const { data: characters, isLoading, isError, error, refetch } = useCharacters()
  const mutations = useCharacterMutations()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const list = characters ?? []
    if (!search.trim()) return list
    const needle = search.trim().toLowerCase()
    return list.filter((c) => c.name.toLowerCase().includes(needle))
  }, [characters, search])

  const selected = filtered.find((c) => c.id === selectedId) ?? null

  const createDraft = () => {
    mutations.create.mutate(
      { name: 'New Character' },
      {
        onSuccess: (character) => {
          setSelectedId(character.id)
          toast({ kind: 'success', title: 'Character created — start writing' })
        },
        onError: (err) => toast({ kind: 'error', title: 'Create failed', description: err.message }),
      },
    )
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl gap-0">
      <div className="flex w-72 shrink-0 flex-col border-r border-mirai-border px-4 py-6">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="font-display text-sm font-bold text-mirai-text">Characters</h1>
          <Button size="sm" variant="primary" loading={mutations.create.isPending} onClick={createDraft}>
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>
        <div className="relative mb-3">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-mirai-faint" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Search cast…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner className="h-4 w-4" />
            </div>
          ) : isError ? (
            <ErrorState
              title="Cast failed to load"
              message={error instanceof MiraiError ? error.message : 'Unknown error'}
              onRetry={() => void refetch()}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<UserRound className="h-5 w-5" />}
              title={search ? 'No matches' : 'No characters yet'}
              description={search ? 'Try another name.' : 'Create your protagonist — the AI Assist will use this profile for canon-aware help.'}
              className="min-h-40"
            />
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((character) => (
                <li key={character.id}>
                  <button
                    onClick={() => setSelectedId(character.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                      character.id === selectedId
                        ? 'bg-mirai-hover text-mirai-text'
                        : 'text-mirai-dim hover:bg-mirai-hover/60 hover:text-mirai-text'
                    }`}
                  >
                    <span className="truncate text-xs font-semibold">{character.name}</span>
                    <span className="shrink-0 text-[10px] text-mirai-faint">
                      {ROLE_LABEL[character.role] ?? character.role}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 px-6 py-6">
        {selected ? (
          <CharacterEditor key={selected.id} character={selected} />
        ) : (
          <EmptyState
            icon={<UserRound className="h-5 w-5" />}
            title="Select a character"
            description="Pick someone from the cast — or create a new character and give them a soul."
            className="h-full"
          />
        )}
      </div>
    </div>
  )
}

function CharacterEditor({ character }: { character: CharacterRecord }) {
  const mutations = useCharacterMutations()
  const approval = useApprovalTransition()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [form, setForm] = useState({
    name: character.name,
    role: character.role,
    age: character.age ?? '',
    personality: character.personality ?? '',
    appearance: character.appearance ?? '',
    voice: character.voice ?? '',
    bio: character.bio ?? '',
    goals: character.goals ?? '',
    fears: character.fears ?? '',
    notes: character.notes ?? '',
    status: character.status as AssetStatus,
  })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dirty =
    form.name !== character.name ||
    form.role !== character.role ||
    form.age !== (character.age ?? '') ||
    form.personality !== (character.personality ?? '') ||
    form.appearance !== (character.appearance ?? '') ||
    form.voice !== (character.voice ?? '') ||
    form.bio !== (character.bio ?? '') ||
    form.goals !== (character.goals ?? '') ||
    form.fears !== (character.fears ?? '') ||
    form.notes !== (character.notes ?? '') ||
    form.status !== character.status

  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const save = () => {
    mutations.update.mutate(
      {
        id: character.id,
        input: {
          name: form.name.trim(),
          role: form.role,
          age: form.age.trim() || undefined,
          personality: form.personality.trim() || undefined,
          appearance: form.appearance.trim() || undefined,
          voice: form.voice.trim() || undefined,
          bio: form.bio.trim() || undefined,
          goals: form.goals.trim() || undefined,
          fears: form.fears.trim() || undefined,
          notes: form.notes.trim() || undefined,
        },
      },
      {
        onSuccess: () => toast({ kind: 'success', title: `Saved “${form.name}”` }),
        onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
      },
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge tone={form.status === 'DRAFT' ? 'neutral' : 'accent'}>{form.status}</Badge>
          {dirty && <span className="text-[10px] font-semibold text-mirai-accent">Unsaved changes</span>}
          {(character.status === 'LOCKED' || character.status === 'FINAL') && (
            <Badge tone="accent">{character.status} — edits need a revision loop</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <VersionHistoryButton onClick={() => setHistoryOpen(true)} />
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
          <Button size="sm" variant="primary" disabled={!dirty} loading={mutations.update.isPending} onClick={save}>
            Save Character
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-1">
            <Label htmlFor="ch-name">Name</Label>
            <Input id="ch-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ch-role">Role</Label>
            <Select id="ch-role" value={form.role} onChange={(e) => set('role', e.target.value)}>
              {CHARACTER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="ch-age">Age</Label>
            <Input id="ch-age" value={form.age} onChange={(e) => set('age', e.target.value)} placeholder="17" />
          </div>
        </div>

        <Field label="Personality" hint="How they act, speak, fail." value={form.personality} onChange={(v) => set('personality', v)} rows={3} id="ch-personality" />
        <Field label="Appearance" hint="Hair, eyes, silhouette — used for visual consistency later." value={form.appearance} onChange={(v) => set('appearance', v)} rows={3} id="ch-appearance" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Voice" hint="Pitch, mannerisms, quirks." value={form.voice} onChange={(v) => set('voice', v)} rows={2} id="ch-voice" />
          <Field label="Goals" hint="What drives them." value={form.goals} onChange={(v) => set('goals', v)} rows={2} id="ch-goals" />
          <Field label="Fears" hint="What stops them." value={form.fears} onChange={(v) => set('fears', v)} rows={2} id="ch-fears" />
          <div>
            <Label htmlFor="ch-status">Status (governed pipeline)</Label>
            <Select
              id="ch-status"
              value={form.status}
              onChange={(e) => {
                const toStatus = e.target.value
                const from = form.status
                set('status', toStatus)
                // Every change goes through the audited approval pipeline.
                approval.mutate(
                  {
                    entityType: 'CHARACTER',
                    entityId: character.id,
                    toStatus,
                    actorName: 'Director',
                  },
                  {
                    onError: (err) => {
                      set('status', from)
                      toast({ kind: 'error', title: 'Transition blocked', description: err.message })
                    },
                  },
                )
              }}
            >
              {ASSET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-[10px] text-mirai-faint">
              Transitions are validated & logged — see Production → Approvals.
            </p>
          </div>
        </div>
        <Field label="Biography" hint="Their story so far." value={form.bio} onChange={(v) => set('bio', v)} rows={5} id="ch-bio" />
        <Field label="Notes" hint="Anything else — continuity details, trivia." value={form.notes} onChange={(v) => set('notes', v)} rows={3} id="ch-notes" />
      </div>

      <VersionHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        entityType="CHARACTER"
        entityId={character.id}
        entityLabel={character.name}
      />

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete “${character.name}”?`}
        description="The character is removed from the project and from any scene cast. This cannot be undone (Phase 7 brings entity versioning)."
        confirmLabel="Delete Character"
        danger
        busy={mutations.remove.isPending}
        onConfirm={() =>
          mutations.remove.mutate(character.id, {
            onSuccess: () => {
              setConfirmDelete(false)
              toast({ kind: 'success', title: `Deleted “${character.name}”` })
            },
            onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }),
          })
        }
      />
    </div>
  )
}

function Field({
  label,
  hint,
  value,
  onChange,
  rows,
  id,
}: {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  rows: number
  id: string
}) {
  return (
    <div>
      <Label htmlFor={id}>
        {label}
        {hint && <span className="ml-2 font-normal text-mirai-faint">{hint}</span>}
      </Label>
      <Textarea id={id} rows={rows} data-selectable="true" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
