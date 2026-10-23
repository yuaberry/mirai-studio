/**
 * CharacterRelations (v0.21, Phase 1) — relationships graph + costumes for
 * one character. The graph is a pure-SVG radial: the character at the
 * center, relations as spokes (real data from the relationships table).
 */
import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { RELATIONSHIP_KINDS, type CharacterRecord, type CharacterRelationship } from '@mirai/shared'
import { Button, Input, Label, Select } from '../../system/ui'
import { useCharacters, useCostumeMutations, useCostumes, useRelationshipMutations, useRelationships } from '../../lib/queries'
import { toast } from '../../store/appStore'

const KIND_COLOR: Record<string, string> = {
  ALLY: '#34d399',
  RIVAL: '#fbbf24',
  FAMILY: '#a78bfa',
  ROMANTIC: '#f472b6',
  MENTOR: '#22d3ee',
  STUDENT: '#22d3ee',
  ENEMY: '#f87171',
  UNKNOWN: '#9aa3b5',
}

export function CharacterRelations({ character }: { character: CharacterRecord }) {
  const { data: characters } = useCharacters()
  const { data: relationships } = useRelationships()
  const relMutations = useRelationshipMutations()
  const { data: costumes } = useCostumes(character.id)
  const costumeMutations = useCostumeMutations()

  const [toId, setToId] = useState('')
  const [kind, setKind] = useState<'ALLY'>('ALLY')
  const [notes, setNotes] = useState('')
  const [costumeName, setCostumeName] = useState('')
  const [costumeDesc, setCostumeDesc] = useState('')

  const mine = useMemo(
    () => (relationships ?? []).filter((r) => r.fromCharacterId === character.id || r.toCharacterId === character.id),
    [relationships, character.id],
  )
  const nameOf = (id: string) => characters?.find((c) => c.id === id)?.name ?? '—'
  const others = (characters ?? []).filter((c) => c.id !== character.id)

  const addRelationship = () => {
    if (!toId) return
    relMutations.create.mutate(
      { fromCharacterId: character.id, toCharacterId: toId, kind, notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          toast({ kind: 'success', title: 'Relationship added' })
          setToId('')
          setNotes('')
        },
        onError: (err) => toast({ kind: 'error', title: 'Add failed', description: err.message }),
      },
    )
  }

  const addCostume = () => {
    if (!costumeName.trim()) return
    costumeMutations.create.mutate(
      { characterId: character.id, name: costumeName.trim(), description: costumeDesc.trim() || undefined },
      {
        onSuccess: () => {
          toast({ kind: 'success', title: 'Costume registered' })
          setCostumeName('')
          setCostumeDesc('')
        },
        onError: (err) => toast({ kind: 'error', title: 'Add failed', description: err.message }),
      },
    )
  }

  return (
    <div className="space-y-4 rounded-lg border border-mirai-border bg-mirai-panel p-4">
      {/* ---- radial graph ---- */}
      <div>
        <p className="mb-2 text-[10px] font-bold tracking-wider text-mirai-faint uppercase">
          Relationships ({mine.length})
        </p>
        {mine.length === 0 ? (
          <p className="text-[11px] text-mirai-faint">No relationships yet — connect this character to the cast below.</p>
        ) : (
          <RelationsGraph character={character} relations={mine} nameOf={nameOf} />
        )}
        {mine.length > 0 && (
          <ul className="mt-2 space-y-1">
            {mine.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-mirai-dim">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: KIND_COLOR[r.kind] }} />
                  {r.fromCharacterId === character.id ? '→ ' : '← '}
                  <span className="font-semibold text-mirai-text">{nameOf(r.fromCharacterId === character.id ? r.toCharacterId : r.fromCharacterId)}</span>
                  {' '}· {r.kind}{r.notes ? ` — ${r.notes}` : ''}
                </span>
                <button
                  className="flex-none text-mirai-faint transition-colors hover:text-red-400"
                  onClick={() => relMutations.remove.mutate(r.id)}
                  title="Remove relationship"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- add relationship ---- */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-36 flex-1">
          <Label className="text-[10px]">Character</Label>
          <Select value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">—</option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-32">
          <Label className="text-[10px]">Kind</Label>
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {RELATIONSHIP_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-36 flex-1">
          <Label className="text-[10px]">Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
        </div>
        <Button size="sm" variant="primary" disabled={!toId} loading={relMutations.create.isPending} onClick={addRelationship}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* ---- costumes ---- */}
      <div className="border-t border-mirai-border pt-3">
        <p className="mb-2 text-[10px] font-bold tracking-wider text-mirai-faint uppercase">
          Costumes ({costumes?.length ?? 0})
        </p>
        {(costumes ?? []).map((c) => (
          <div key={c.id} className="mb-1 flex items-start justify-between gap-2 rounded-md border border-mirai-line bg-mirai-hover/40 px-2 py-1.5">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-mirai-text">{c.name}{c.occasion ? <span className="ml-1 font-normal text-mirai-faint">· {c.occasion}</span> : null}</p>
              {c.description && <p className="text-[10px] leading-snug text-mirai-dim">{c.description}</p>}
            </div>
            <button
              className="flex-none text-mirai-faint transition-colors hover:text-red-400"
              onClick={() => costumeMutations.remove.mutate({ id: c.id, characterId: character.id })}
              title="Remove costume"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="min-w-32 flex-1">
            <Label className="text-[10px]">Costume name</Label>
            <Input value={costumeName} onChange={(e) => setCostumeName(e.target.value)} placeholder="Uniform de combate" />
          </div>
          <div className="min-w-36 flex-1">
            <Label className="text-[10px]">Description</Label>
            <Input value={costumeDesc} onChange={(e) => setCostumeDesc(e.target.value)} placeholder="visual details" />
          </div>
          <Button size="sm" variant="outline" disabled={!costumeName.trim()} loading={costumeMutations.create.isPending} onClick={addCostume}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Pure-SVG radial graph: the character centered, relations as spokes. */
function RelationsGraph({
  character,
  relations,
  nameOf,
}: {
  character: CharacterRecord
  relations: CharacterRelationship[]
  nameOf: (id: string) => string
}) {
  const size = 300
  const cx = size / 2
  const cy = size / 2
  const radius = 108
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-56 w-56">
      {relations.map((r, i) => {
        const angle = (2 * Math.PI * i) / relations.length - Math.PI / 2
        const x = cx + radius * Math.cos(angle)
        const y = cy + radius * Math.sin(angle)
        const otherId = r.fromCharacterId === character.id ? r.toCharacterId : r.fromCharacterId
        const label = nameOf(otherId)
        return (
          <g key={r.id}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke={KIND_COLOR[r.kind]} strokeOpacity={0.55} strokeWidth={2} />
            <circle cx={x} cy={y} r={5} fill={KIND_COLOR[r.kind]} />
            <text
              x={x + (x >= cx ? 8 : -8)}
              y={y + 4}
              textAnchor={x >= cx ? 'start' : 'end'}
              fill="#9aa3b5"
              fontSize={10.5}
            >
              {label.length > 12 ? `${label.slice(0, 11)}…` : label}
            </text>
          </g>
        )
      })}
      <circle cx={cx} cy={cy} r={30} fill="#1a1f2e" stroke="#f472b6" strokeOpacity={0.7} strokeWidth={2} />
      <text x={cx} y={cy + 3.5} textAnchor="middle" fill="#e8eaf0" fontSize={10.5} fontWeight="bold">
        {character.name.length > 8 ? `${character.name.slice(0, 7)}…` : character.name}
      </text>
    </svg>
  )
}
