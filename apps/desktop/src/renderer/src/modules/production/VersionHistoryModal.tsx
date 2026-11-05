/**
 * VersionHistoryModal (Phase 7) — entity versioning UI: snapshot the live
 * record, browse versions, inspect real field diffs, restore (with the
 * automatic pre-restore safety snapshot).
 */
import { useState } from 'react'
import { Clock, GitCompareArrows, HardDriveDownload, Undo2 } from 'lucide-react'
import {
  type EntityVersion,
  type VersionDiffEntry,
  type VersionableEntityType,
} from '@mirai/shared'
import { useVersionMutations, useVersions } from '../../lib/queries'
import { toast } from '../../store/appStore'
import { Button } from '../../system/ui'
import { ConfirmModal, Modal } from '../../system/Modal'
import { cn } from '../../lib/utils'

export interface VersionHistoryModalProps {
  open: boolean
  onClose: () => void
  entityType: VersionableEntityType
  entityId: string
  entityLabel: string
}

export function VersionHistoryModal(props: VersionHistoryModalProps) {
  const { open, onClose, entityType, entityId, entityLabel } = props
  const { data: versions, isLoading } = useVersions(entityType, entityId)
  const mutations = useVersionMutations()
  const [diff, setDiff] = useState<VersionDiffEntry[] | null>(null)
  const [diffLabel, setDiffLabel] = useState<string>('')
  const [diffBase, setDiffBase] = useState<string | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<EntityVersion | null>(null)
  const [label, setLabel] = useState('')

  const runDiff = (base: EntityVersion, target: EntityVersion) => {
    mutations.diff.mutate(
      { fromVersionId: base.id, toVersionId: target.id },
      {
        onSuccess: (entries) => {
          setDiff(entries)
          setDiffLabel(`v${base.version} → v${target.version}`)
          setDiffBase(base.id)
        },
      },
    )
  }

  return (
    <Modal open={open} onClose={onClose} title={`Version history — ${entityLabel}`} width="max-w-2xl">
      <div className="flex flex-col gap-3">
        {/* snapshot a new version */}
        <div className="flex items-center gap-2">
          <input
            className="h-8 flex-1 rounded-md border border-mirai-line bg-mirai-bg px-2.5 text-xs text-mirai-text placeholder:text-mirai-faint"
            placeholder="Snapshot label (e.g. 'after design review')"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button
            size="sm"
            variant="primary"
            loading={mutations.snapshot.isPending}
            onClick={() => {
              mutations.snapshot.mutate(
                { entityType, entityId, label: label.trim() || undefined },
                {
                  onSuccess: (v) => {
                    toast({ kind: 'success', title: `Snapshot v${v.version} saved` })
                    setLabel('')
                  },
                  onError: (err) => toast({ kind: 'error', title: 'Snapshot failed', description: err.message }),
                },
              )
            }}
          >
            <Clock className="h-3.5 w-3.5" /> Snapshot current
          </Button>
        </div>

        {isLoading ? (
          <p className="text-xs text-mirai-faint">Loading…</p>
        ) : (versions ?? []).length === 0 ? (
          <p className="text-xs text-mirai-faint">
            No versions yet — snapshot before risky edits and restore anytime.
          </p>
        ) : (
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {(versions ?? []).map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between gap-2 rounded-md border border-mirai-line bg-mirai-panel px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-mirai-text">
                    v{v.version}
                    {v.label && <span className="ml-1.5 font-normal text-mirai-faint">— {v.label}</span>}
                  </p>
                  <p className="text-[10px] text-mirai-faint">{new Date(v.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex flex-none gap-1">
                  {diffBase === v.id ? (
                    <span className="rounded bg-mirai-pink/15 px-1.5 py-0.5 text-[10px] text-mirai-pink">diff base</span>
                  ) : (
                    <button
                      className="rounded p-1 text-mirai-faint transition-colors hover:bg-mirai-hover hover:text-mirai-text"
                      title="Diff against this version"
                      onClick={() => {
                        const newer = (versions ?? []).find((x) => x.version === v.version + 1)
                        if (newer) runDiff(v, newer)
                        else {
                          const latest = versions![0]!
                          if (latest.id !== v.id) runDiff(v, latest)
                          else toast({ kind: 'info', title: 'This is the only version' })
                        }
                      }}
                    >
                      <GitCompareArrows className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    className="rounded p-1 text-mirai-faint transition-colors hover:bg-mirai-hover hover:text-mirai-pink"
                    title="Restore this version (current state is auto-snapshotted first)"
                    onClick={() => setRestoreTarget(v)}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* diff panel */}
        {diff && (
          <div className="rounded-md border border-mirai-line bg-mirai-panel p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-mirai-dim">
              <GitCompareArrows className="h-3.5 w-3.5" /> Diff {diffLabel}
            </p>
            {diff.length === 0 ? (
              <p className="text-[11px] text-mirai-faint">No field changes.</p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {diff.map((entry) => (
                  <div key={entry.field} className="rounded bg-mirai-bg px-2 py-1">
                    <p className="text-[10px] font-bold tracking-wide text-mirai-pink uppercase">{entry.field}</p>
                    <p className="text-[11px] text-mirai-faint line-through">{entry.from ?? '∅'}</p>
                    <p className="text-[11px] text-mirai-text">{entry.to ?? '∅'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        open={restoreTarget !== null}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => {
          if (restoreTarget) {
            mutations.restore.mutate(restoreTarget.id, {
              onSuccess: () => {
                toast({
                  kind: 'success',
                  title: `Restored v${restoreTarget.version}`,
                  description: 'The pre-restore state was saved as a safety snapshot.',
                })
                setDiff(null)
              },
              onError: (err) => toast({ kind: 'error', title: 'Restore failed', description: err.message }),
            })
          }
          setRestoreTarget(null)
        }}
        title={`Restore v${restoreTarget?.version ?? ''}?`}
        description="The CURRENT state is snapshotted automatically first — nothing is ever lost. Reload the editor data after restoring."
        confirmLabel="Restore version"
      />
    </Modal>
  )
}

/** Small trigger button for embedding in editors. */
export function VersionHistoryButton({
  onClick,
  className,
}: {
  onClick: () => void
  className?: string
}) {
  return (
    <button
      className={cn(
        'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-mirai-faint transition-colors hover:bg-mirai-hover hover:text-mirai-text',
        className,
      )}
      title="Version history (snapshot / restore / diff)"
      onClick={onClick}
    >
      <HardDriveDownload className="h-3 w-3" /> History
    </button>
  )
}
