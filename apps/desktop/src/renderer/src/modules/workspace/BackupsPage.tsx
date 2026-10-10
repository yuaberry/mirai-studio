/**
 * Backups page — wraps the backups panel (spec §49).
 */
import { BackupsPanel } from './BackupsPanel'
import { useCurrentProject } from '../../lib/queries'

export function BackupsPage() {
  const { data: project } = useCurrentProject()
  if (!project) return null
  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <h1 className="mb-6 font-display text-xl font-bold text-mirai-text">Backups</h1>
      <BackupsPanel projectId={project.id} />
    </div>
  )
}
