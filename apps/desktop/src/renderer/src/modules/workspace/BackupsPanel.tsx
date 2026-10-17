/**
 * Backups panel — never lose work (spec §49):
 * create, restore (with automatic pre-restore snapshot), delete (last one guarded).
 */
import { useState } from 'react'
import { HardDrive, RotateCcw, Trash2 } from 'lucide-react'
import { MiraiError, type BackupInfo } from '@mirai/shared'
import { Button, Spinner } from '../../system/ui'
import { EmptyState, ErrorState } from '../../system/EmptyState'
import { ConfirmModal } from '../../system/Modal'
import { formatBytes, formatWhen } from '../../lib/utils'
import { useBackups, useBackupActions, useProjectAction } from '../../lib/queries'
import { toast } from '../../store/appStore'

export function BackupsPanel({ projectId }: { projectId: string }) {
  const { data: backups, isLoading, isError, error, refetch } = useBackups(projectId)
  const projectAction = useProjectAction()
  const backupActions = useBackupActions(projectId)
  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BackupInfo | null>(null)

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }
  if (isError) {
    return (
      <ErrorState
        title="Backups failed to load"
        message={error instanceof MiraiError ? error.message : 'Unknown error'}
        onRetry={() => void refetch()}
      />
    )
  }

  const list = backups ?? []

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="max-w-xl text-xs text-mirai-dim">
          Restoring always takes a safety snapshot of the current state first. The last remaining
          backup can never be deleted.
        </p>
        <Button
          size="sm"
          variant="outline"
          loading={projectAction.isPending}
          onClick={() =>
            projectAction.mutate(
              { kind: 'backup', id: projectId },
              {
                onSuccess: () => toast({ kind: 'success', title: 'Backup created' }),
                onError: (err) => toast({ kind: 'error', title: 'Backup failed', description: err.message }),
              },
            )
          }
        >
          <HardDrive className="h-3.5 w-3.5" /> Create Backup
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="panel border-dashed">
          <EmptyState
            icon={<HardDrive className="h-5 w-5" />}
            title="No backups yet"
            description="Create your first snapshot — Mirai copies the whole project folder (files + database) into its managed backup area."
          />
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((backup) => (
            <div key={backup.id} className="panel flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-mirai-text">{backup.id}</p>
                <p className="mt-0.5 text-[11px] text-mirai-faint">
                  {formatWhen(backup.createdAt)} · {formatBytes(backup.sizeBytes)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setRestoreTarget(backup)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Restore
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(backup)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={restoreTarget !== null}
        onClose={() => setRestoreTarget(null)}
        title={`Restore backup ${restoreTarget?.id ?? ''}?`}
        description="The current project state is snapshotted automatically before the restore, so nothing is lost. If this project is open, it will be closed — reopen it afterwards."
        confirmLabel="Restore Backup"
        busy={backupActions.isPending}
        onConfirm={() =>
          backupActions.mutate(
            { kind: 'restoreBackup', backupId: restoreTarget!.id },
            {
              onSuccess: () => {
                setRestoreTarget(null)
                toast({
                  kind: 'success',
                  title: 'Backup restored',
                  description: 'A pre-restore snapshot was also created.',
                })
              },
              onError: (err) => toast({ kind: 'error', title: 'Restore failed', description: err.message }),
            },
          )
        }
      />

      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={`Delete backup ${deleteTarget?.id ?? ''}?`}
        description="The backup folder is permanently removed. The last remaining backup is protected and cannot be deleted."
        confirmLabel="Delete Backup"
        danger
        busy={backupActions.isPending}
        onConfirm={() =>
          backupActions.mutate(
            { kind: 'deleteBackup', backupId: deleteTarget!.id },
            {
              onSuccess: () => {
                setDeleteTarget(null)
                toast({ kind: 'success', title: 'Backup deleted' })
              },
              onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }),
            },
          )
        }
      />
    </div>
  )
}
