/**
 * Diagnostics (spec §14, §16) — health report + live, filterable log tail.
 */
import { useState } from 'react'
import { RefreshCw, Terminal, Trash2 } from 'lucide-react'
import { LOG_CATEGORIES, LOG_LEVELS, type LogEntry } from '@mirai/shared'
import { Badge, Button, Card, Input, SectionTitle, Select, Spinner } from '../../system/ui'
import { EmptyState } from '../../system/EmptyState'
import { formatClock } from '../../lib/utils'
import { invoke } from '../../lib/ipc'
import { useHealth, useLogs, useAiStatus } from '../../lib/queries'
import { toast } from '../../store/appStore'

const LEVEL_COLORS: Record<string, string> = {
  debug: 'text-mirai-faint',
  info: 'text-mirai-accent-3',
  warning: 'text-mirai-warn',
  error: 'text-mirai-danger',
}

const CATEGORY_TONES: Record<string, 'neutral' | 'accent' | 'info' | 'warn' | 'danger' | 'violet'> = {
  SYSTEM: 'neutral',
  PROJECT: 'accent',
  DB: 'info',
  JOBS: 'accent',
  AI: 'violet',
  RENDER: 'warn',
  MEDIA: 'warn',
  IPC: 'neutral',
}

export function DiagnosticsPage() {
  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useHealth()
  const { data: ai } = useAiStatus()
  const [level, setLevel] = useState('all')
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const { data: logs, isLoading: logsLoading, refetch: refetchLogs } = useLogs({ level, category, search })

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-10">
      <h1 className="mb-8 font-display text-2xl font-bold text-mirai-text">Diagnostics</h1>

      <Card className="mb-6 p-5">
        <SectionTitle
          right={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" loading={healthLoading} onClick={() => void refetchHealth()}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  invoke('logs:revealLogsFolder').catch((err: Error) =>
                    toast({ kind: 'error', title: 'Could not open logs folder', description: err.message }),
                  )
                }}
              >
                <Terminal className="h-3.5 w-3.5" /> Open Logs Folder
              </Button>
            </div>
          }
        >
          System health
        </SectionTitle>

        {!health ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner className="h-5 w-5" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <HealthItem label="Mirai Studio" value={`v${health.appVersion}`} />
            <HealthItem label="Electron" value={health.electronVersion} />
            <HealthItem label="Node" value={health.nodeVersion} />
            <HealthItem label="Platform" value={`${health.platform} · ${health.arch}`} />
            <BoolItem label="Native SQLite" ok={health.nativeSqlite === 'ok'} />
            <BoolItem label="App database" ok={health.appDb === 'ok'} />
            <BoolItem label="Secure storage" ok={health.secureStorage} warnWhenFalse />
            <BoolItem
              label="AI configured"
              ok={ai?.configured ?? false}
              note={ai?.configured ? undefined : 'No OpenRouter key (Settings → AI)'}
            />
            {health.ffmpeg ? (
              <HealthItem label="FFmpeg" value={health.ffmpeg.version ?? 'found'} />
            ) : (
              <BoolItem label="FFmpeg" ok={false} note="Not on PATH — needed for Phase 6 render/export" />
            )}
            <HealthItem label="Data folder" value={health.userDataPath} mono truncate />
          </div>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle
          right={
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                invoke('logs:clear')
                  .then(() => refetchLogs())
                  .catch(() => undefined)
              }
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear Current Log
            </Button>
          }
        >
          Log stream
        </SectionTitle>

        <div className="mb-3 grid grid-cols-[110px_110px_1fr] gap-2">
          <Select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Filter by level">
            <option value="all">All levels</option>
            {LOG_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
            <option value="all">All categories</option>
            {LOG_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Input placeholder="Search messages…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="max-h-96 overflow-y-auto rounded-lg border border-mirai-border bg-mirai-base p-2">
          {logsLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner className="h-5 w-5" />
            </div>
          ) : !logs || logs.length === 0 ? (
            <EmptyState
              icon={<Terminal className="h-5 w-5" />}
              title="No log entries match"
              description="Produce some activity (open a project, run validation) or relax the filters."
              className="min-h-32"
            />
          ) : (
            <div className="space-y-0.5">
              {logs.map((entry, i) => (
                <LogRow key={`${entry.ts}-${i}`} entry={entry} />
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

function HealthItem({
  label,
  value,
  mono = false,
  truncate = false,
}: {
  label: string
  value: string
  mono?: boolean
  truncate?: boolean
}) {
  return (
    <div className="rounded-lg border border-mirai-border bg-mirai-panel px-3 py-2">
      <p className="text-[10px] font-semibold tracking-wider text-mirai-faint uppercase">{label}</p>
      <p className={`mt-0.5 text-xs text-mirai-text ${mono ? 'font-mono' : ''} ${truncate ? 'truncate' : ''}`} title={value}>
        {value}
      </p>
    </div>
  )
}

function BoolItem({
  label,
  ok,
  warnWhenFalse = false,
  note,
}: {
  label: string
  ok: boolean
  warnWhenFalse?: boolean
  note?: string
}) {
  return (
    <div className="rounded-lg border border-mirai-border bg-mirai-panel px-3 py-2">
      <p className="text-[10px] font-semibold tracking-wider text-mirai-faint uppercase">{label}</p>
      <p
        className={`mt-0.5 flex items-center gap-1 text-xs ${
          ok ? 'text-mirai-success' : warnWhenFalse ? 'text-mirai-warn' : 'text-mirai-danger'
        }`}
      >
        {ok ? '✓' : '✕'} {ok ? 'OK' : (note ?? 'Not available')}
      </p>
    </div>
  )
}

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <div className="flex items-baseline gap-2 rounded px-2 py-1 font-mono text-[11px] leading-relaxed hover:bg-mirai-hover/50">
      <span className="shrink-0 text-mirai-faint">{formatClock(entry.ts)}</span>
      <span className={`shrink-0 font-semibold uppercase ${LEVEL_COLORS[entry.level] ?? ''}`}>
        {entry.level}
      </span>
      <Badge tone={CATEGORY_TONES[entry.category] ?? 'neutral'} className="shrink-0">
        {entry.category}
      </Badge>
      <span className="min-w-0 break-words text-mirai-dim" data-selectable="true">
        {entry.message}
      </span>
    </div>
  )
}
