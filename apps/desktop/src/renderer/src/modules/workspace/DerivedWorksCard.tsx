/**
 * DerivedWorksCard (v0.24) — the IP graph (§4) for the open project:
 * derived works in BOTH directions (children it spawned, parents it
 * derives from) with real inheritance on creation (bible / style bible /
 * characters / locations copied into the new project's DB).
 */
import { useState } from 'react'
import { ArrowUpRight, GitBranch, Plus, Trash2 } from 'lucide-react'
import type { ProjectSummary } from '@mirai/shared'
import { Badge, Button, Input, Label, Select, Spinner, Textarea } from '../../system/ui'
import { Modal } from '../../system/Modal'
import { useDerivedWorks, useDerivedWorkMutations } from '../../lib/queries'
import { invoke } from '../../lib/ipc'
import { toast } from '../../store/appStore'

const KIND_LABEL: Record<string, string> = {
  ADAPTATION: 'Adaptation',
  SPIN_OFF: 'Spin-off',
  SEQUEL: 'Sequel',
  PREQUEL: 'Prequel',
  TRANSLATION: 'Translation',
  OTHER: 'Other',
}

export function DerivedWorksCard({ project }: { project: ProjectSummary }) {
  const { data: works, isLoading, isError, refetch } = useDerivedWorks(project.id)
  const mutations = useDerivedWorkMutations()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState(`${project.name} — Mangá`)
  const [kind, setKind] = useState('ADAPTATION')
  const [notes, setNotes] = useState('')
  const [inherit, setInherit] = useState({
    storyBible: true,
    styleBible: true,
    characters: true,
    locations: false,
  })

  const create = () => {
    mutations.create.mutate(
      {
        parentId: project.id,
        name,
        kind: kind as never,
        notes: notes || undefined,
        inherit,
      },
      {
        onSuccess: (child) => {
          setCreateOpen(false)
          toast({ kind: 'success', title: 'Derived work created', description: `${child.name} — ${KIND_LABEL[kind] ?? kind} with the inherited canon.` })
        },
      },
    )
  }

  return (
    <div className="col-span-2 rounded-lg border border-mirai-border bg-mirai-panel/40 p-5 xl:col-span-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 text-mirai-accent" />
          <h2 className="font-display text-[11px] font-bold tracking-[0.16em] text-mirai-text uppercase">
            IP — derived works
          </h2>
          <span className="text-[10px] text-mirai-faint">
            adaptations, sequels, spin-offs — canon travels, projects stay independent
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> New derived work
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-16 items-center justify-center">
          <Spinner className="h-4 w-4" />
        </div>
      ) : isError ? (
        <p className="text-[11px] text-mirai-faint" role="button" onClick={() => void refetch()}>
          Failed to load — click to retry.
        </p>
      ) : (works ?? []).length === 0 ? (
        <p className="text-[11px] text-mirai-faint">
          No derived works yet — this IP stands alone. Spawn a manga adaptation, a sequel season, a
          translated edition…
        </p>
      ) : (
        <ul className="space-y-1.5">
          {(works ?? []).map((work) => (
            <li
              key={work.id}
              className="flex items-center gap-2 rounded border border-mirai-border/70 bg-mirai-bg/40 px-3 py-2"
            >
              <Badge tone={work.direction === 'child' ? 'accent' : 'info'}>
                {work.direction === 'child' ? '→ derives' : '← derived from'}
              </Badge>
              <span className="text-xs font-semibold text-mirai-text">
                {work.other ? work.other.name : 'unregistered project'}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-mirai-faint">
                {KIND_LABEL[work.kind] ?? work.kind}
              </span>
              {work.notes ? <span className="truncate text-[10px] text-mirai-faint">{work.notes}</span> : null}
              <span className="ml-auto text-[10px] text-mirai-faint">
                {work.direction === 'child' && work.other ? (
                  <span
                    role="button"
                    className="flex items-center gap-1 hover:text-mirai-text"
                    title="Reveal the derived project folder"
                    onClick={() =>
                      void invoke('projects:revealInFolder', { id: work.other!.id }).catch((err: Error) =>
                        toast({ kind: 'error', title: 'Reveal failed', description: err.message }),
                      )
                    }
                  >
                    <ArrowUpRight className="h-3 w-3" />
                  </span>
                ) : null}
              </span>
              <button
                className="rounded p-1 text-mirai-faint hover:text-red-400"
                title="Unlink (never deletes the project)"
                onClick={() =>
                  mutations.remove.mutate({ id: work.id, projectId: project.id })
                }
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New derived work">
        <div className="space-y-3">
          <div>
            <Label htmlFor="dw-name">Name</Label>
            <Input id="dw-name" className="h-9 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="dw-kind">Kind</Label>
            <Select id="dw-kind" className="h-9 text-xs" value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KIND_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Canon to inherit</Label>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['storyBible', 'Story Bible'],
                  ['styleBible', 'Style Bible'],
                  ['characters', 'Characters'],
                  ['locations', 'Locations'],
                ] as const
              ).map(([flag, label]) => (
                <button
                  key={flag}
                  onClick={() => setInherit((f) => ({ ...f, [flag]: !f[flag] }))}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    inherit[flag]
                      ? 'border-mirai-accent/40 bg-mirai-accent/15 text-mirai-accent'
                      : 'border-mirai-border-strong bg-mirai-panel text-mirai-faint hover:text-mirai-dim'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="dw-notes">Notes</Label>
            <Textarea
              id="dw-notes"
              rows={2}
              className="text-xs"
              placeholder="Why this work exists — direction, market, target…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <p className="text-[10px] text-mirai-faint">
            A real new project is created beside this one — the chosen canon is copied into it. The
            projects stay independent afterwards.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={mutations.create.isPending}
              disabled={name.trim().length === 0}
              onClick={create}
            >
              <Plus className="h-3.5 w-3.5" /> Create
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
