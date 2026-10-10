/**
 * Location Studio (Module 10) — places of the world, used by scenes.
 */
import { useMemo, useState } from 'react'
import { MapPin, Plus, Search, Trash2 } from 'lucide-react'
import { MiraiError, type LocationRecord } from '@mirai/shared'
import { Badge, Button, Input, Label, Textarea, Spinner } from '../../system/ui'
import { EmptyState, ErrorState } from '../../system/EmptyState'
import { ConfirmModal } from '../../system/Modal'
import { useLocations, useLocationMutations } from '../../lib/queries'
import { toast } from '../../store/appStore'

export function LocationsPage() {
  const { data: locations, isLoading, isError, error, refetch } = useLocations()
  const mutations = useLocationMutations()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const list = locations ?? []
    if (!search.trim()) return list
    const needle = search.trim().toLowerCase()
    return list.filter((l) => l.name.toLowerCase().includes(needle))
  }, [locations, search])

  const selected = filtered.find((l) => l.id === selectedId) ?? null

  const createDraft = () => {
    mutations.create.mutate(
      { name: 'New Location' },
      {
        onSuccess: (location) => {
          setSelectedId(location.id)
          toast({ kind: 'success', title: 'Location created' })
        },
        onError: (err) => toast({ kind: 'error', title: 'Create failed', description: err.message }),
      },
    )
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl">
      <div className="flex w-72 shrink-0 flex-col border-r border-mirai-border px-4 py-6">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="font-display text-sm font-bold text-mirai-text">Locations</h1>
          <Button size="sm" variant="primary" loading={mutations.create.isPending} onClick={createDraft}>
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>
        <div className="relative mb-3">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-mirai-faint" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Search places…"
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
              title="Locations failed to load"
              message={error instanceof MiraiError ? error.message : 'Unknown error'}
              onRetry={() => void refetch()}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<MapPin className="h-5 w-5" />}
              title={search ? 'No matches' : 'No locations yet'}
              description={search ? 'Try another name.' : 'Create the places your story lives in.'}
              className="min-h-40"
            />
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((location) => (
                <li key={location.id}>
                  <button
                    onClick={() => setSelectedId(location.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                      location.id === selectedId
                        ? 'bg-mirai-hover text-mirai-text'
                        : 'text-mirai-dim hover:bg-mirai-hover/60 hover:text-mirai-text'
                    }`}
                  >
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-mirai-faint" />
                    <span className="truncate text-xs font-semibold">{location.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 px-6 py-6">
        {selected ? (
          <LocationEditor key={selected.id} location={selected} />
        ) : (
          <EmptyState
            icon={<MapPin className="h-5 w-5" />}
            title="Select a location"
            description="Where does the story happen? Academies, cities, rooftops at midnight."
            className="h-full"
          />
        )}
      </div>
    </div>
  )
}

function LocationEditor({ location }: { location: LocationRecord }) {
  const mutations = useLocationMutations()
  const [form, setForm] = useState({
    name: location.name,
    description: location.description ?? '',
    climate: location.climate ?? '',
    architecture: location.architecture ?? '',
    notes: location.notes ?? '',
  })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dirty =
    form.name !== location.name ||
    form.description !== (location.description ?? '') ||
    form.climate !== (location.climate ?? '') ||
    form.architecture !== (location.architecture ?? '') ||
    form.notes !== (location.notes ?? '')

  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const save = () => {
    mutations.update.mutate(
      {
        id: location.id,
        input: {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          climate: form.climate.trim() || undefined,
          architecture: form.architecture.trim() || undefined,
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
          <Badge tone="neutral">{location.status}</Badge>
          {dirty && <span className="text-[10px] font-semibold text-mirai-accent">Unsaved changes</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
          <Button size="sm" variant="primary" disabled={!dirty} loading={mutations.update.isPending} onClick={save}>
            Save Location
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
        <div>
          <Label htmlFor="lo-name">Name</Label>
          <Input id="lo-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="lo-desc">
            Description
            <span className="ml-2 font-normal text-mirai-faint">What it looks and feels like.</span>
          </Label>
          <Textarea id="lo-desc" rows={4} data-selectable="true" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="lo-climate">Climate & atmosphere</Label>
            <Textarea id="lo-climate" rows={2} data-selectable="true" value={form.climate} onChange={(e) => set('climate', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="lo-arch">Architecture & landmarks</Label>
            <Textarea id="lo-arch" rows={2} data-selectable="true" value={form.architecture} onChange={(e) => set('architecture', e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="lo-notes">Notes</Label>
          <Textarea id="lo-notes" rows={3} data-selectable="true" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete “${location.name}”?`}
        description="The location is removed. Scenes set here keep their screenplay, with the location cleared."
        confirmLabel="Delete Location"
        danger
        busy={mutations.remove.isPending}
        onConfirm={() =>
          mutations.remove.mutate(location.id, {
            onSuccess: () => {
              setConfirmDelete(false)
              toast({ kind: 'success', title: `Deleted “${location.name}”` })
            },
            onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }),
          })
        }
      />
    </div>
  )
}
