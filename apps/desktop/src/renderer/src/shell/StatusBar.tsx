/**
 * StatusBar — ambient state at a glance: active project, live jobs,
 * DB health, app version.
 */
import { Cpu, Database, Film, Wifi, WifiOff } from 'lucide-react'
import { jobIsActive } from '@mirai/shared'
import { useHealth, useJobs, useCurrentProject, useAiStatus } from '../lib/queries'

export function StatusBar() {
  const { data: current } = useCurrentProject()
  const { data: jobs } = useJobs()
  const { data: health } = useHealth()
  const { data: ai } = useAiStatus()

  const activeJobs = (jobs ?? []).filter((j) => jobIsActive(j))
  const running = activeJobs.filter((j) => j.status === 'RUNNING').length
  const dbOk = health?.appDb === 'ok' && health?.nativeSqlite === 'ok'
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between border-t border-mirai-border bg-mirai-raise/60 px-3 text-[11px] text-mirai-faint">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <Film className="h-3 w-3" />
          {current ? <span className="text-mirai-dim">{current.name}</span> : <span>No project open</span>}
        </span>
        {activeJobs.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mirai-accent" />
            {running} running · {activeJobs.length} active
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        {ai?.configured && (
          <span className={`flex items-center gap-1.5 ${online ? 'text-mirai-accent-3' : 'text-mirai-warn'}`}>
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            AI {online ? 'ready' : 'offline'}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <Database className="h-3 w-3" />
          {dbOk ? 'Local DB ready' : 'Checking DB…'}
        </span>
        <span className="flex items-center gap-1.5">
          <Cpu className="h-3 w-3" />
          Mirai Studio v{health?.appVersion ?? '…'}
        </span>
      </div>
    </footer>
  )
}
