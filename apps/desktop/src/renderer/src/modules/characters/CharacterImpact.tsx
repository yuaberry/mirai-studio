/**
 * CharacterImpact (v0.24) — the IP impact screen (§4) for one character:
 * every number is a live count of REAL dependents (scenes, panels,
 * relationships, costumes, shots, subtitles, tasks, versions) straight
 * from the project database.
 */
import { Network } from 'lucide-react'
import type { CharacterRecord } from '@mirai/shared'
import { useEntityImpact } from '../../lib/queries'

export function CharacterImpact({ character }: { character: CharacterRecord }) {
  const { data: impact, isLoading, isError } = useEntityImpact('CHARACTER', character.id)

  if (isLoading) {
    return (
      <div className="rounded-lg border border-mirai-border bg-mirai-panel/40 p-4">
        <p className="text-[11px] text-mirai-faint">Analyzing impact…</p>
      </div>
    )
  }
  if (isError || !impact) return null

  const total = impact.impacts.reduce((acc, e) => acc + e.count, 0)
  if (total === 0) return null

  return (
    <div className="rounded-lg border border-mirai-border bg-mirai-panel/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Network className="h-3.5 w-3.5 text-mirai-accent" />
        <h3 className="font-display text-[11px] font-bold tracking-[0.16em] text-mirai-text uppercase">
          IP impact
        </h3>
        <span className="text-[10px] text-mirai-faint">
          editing {character.name} touches {total} thing{total === 1 ? '' : 's'}:
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {impact.impacts.map((entry) => (
          <span
            key={entry.key}
            title={entry.entityIds.slice(0, 8).join(', ')}
            className="rounded-full border border-mirai-border-strong bg-mirai-bg/60 px-2.5 py-1 text-[11px] font-semibold text-mirai-dim"
          >
            <span className="text-mirai-accent">{entry.count}×</span> {entry.label}
          </span>
        ))}
      </div>
    </div>
  )
}
