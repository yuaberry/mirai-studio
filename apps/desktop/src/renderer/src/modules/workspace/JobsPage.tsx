/**
 * Jobs page — wraps the live queue panel of the open project (spec §8).
 */
import { JobsPanel } from './JobsPanel'
import { T } from '../../system/T'

export function JobsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <h1 className="mb-6 font-display text-xl font-bold text-mirai-text"><T k="Jobs" /></h1>
      <JobsPanel />
    </div>
  )
}
