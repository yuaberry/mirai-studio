/**
 * ImpactPage (V1 Beta Experimental 7) — IP impact screen (§4).
 *
 * A dedicated page showing the REAL impact of any project entity:
 * if you edit this character/scene/episode/location/shot, what does it touch?
 * Every number is a live query from the project database — no caching,
 * no fabrication. Entity pickers are populated from the real services.
 */
import { useMemo, useState } from 'react'
import { Network, ArrowRight, Clock, Users, Building2, Calendar, Film } from 'lucide-react'
import type {
  CharacterRecord,
  EpisodeRecord,
  EpisodeWithStats,
  ImpactKind,
  LocationRecord,
  SceneRecord,
  ShotRecord,
} from '@mirai/shared'
import { Badge, Card, Label, Select, Spinner } from '../../system/ui'
import { EmptyState, ErrorState } from '../../system/EmptyState'
import { useEntityImpact } from '../../lib/queries'
import { useCharacters, useLocations, useEpisodes, useScenes, useShots } from '../../lib/queries'

const IMPACT_KINDS: { value: ImpactKind; label: string; icon: React.ElementType }[] = [
  { value: 'CHARACTER', label: 'Character', icon: Users },
  { value: 'SCENE', label: 'Scene', icon: Calendar },
  { value: 'EPISODE', label: 'Episode', icon: Film },
  { value: 'LOCATION', label: 'Location', icon: Building2 },
  { value: 'SHOT', label: 'Shot', icon: ArrowRight },
]

const KIND_ICON: Record<ImpactKind, React.ElementType> = {
  CHARACTER: Users,
  SCENE: Calendar,
  EPISODE: Film,
  LOCATION: Building2,
  SHOT: ArrowRight,
}

interface EntityOption {
  id: string
  label: string
}

function entitiesByKind(kind: ImpactKind, data: unknown[]): EntityOption[] {
  switch (kind) {
    case 'CHARACTER':
      return (data as CharacterRecord[]).map((c) => ({ id: c.id, label: c.name }))
    case 'SCENE':
      return (data as SceneRecord[]).map((s) => ({ id: s.id, label: s.title }))
    case 'EPISODE':
      return (data as EpisodeRecord[]).map((e) => ({ id: e.id, label: `${e.season}×${e.number} — ${e.title}` }))
    case 'LOCATION':
      return (data as LocationRecord[]).map((l) => ({ id: l.id, label: l.name }))
    case 'SHOT':
      return (data as ShotRecord[]).map((s) => ({ id: s.id, label: s.title || `Shot ${s.orderIndex}` }))
    default:
      return []
  }
}

export function ImpactPage() {
  const [kind, setKind] = useState<ImpactKind>('CHARACTER')
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [selectedEpisodeForScenes, setSelectedEpisodeForScenes] = useState<EpisodeRecord | null>(null)
  const [selectedSceneForShots, setSelectedSceneForShots] = useState<SceneRecord | null>(null)

  // Load all entities for the selected kind so the user can pick one.
  const characters = useCharacters()
  const locations = useLocations()
  const episodes = useEpisodes()
  const scenes = useScenes(selectedEpisodeForScenes?.id ?? undefined)
  const shots = useShots(selectedSceneForShots?.id ?? undefined)

  // Determine the entity list based on kind.
  const entityData: Record<ImpactKind, unknown[]> = useMemo(
    () => ({
      CHARACTER: characters.data ?? [],
      LOCATION: locations.data ?? [],
      EPISODE: episodes.data ?? [],
      SCENE: scenes.data ?? [],
      SHOT: shots.data ?? [],
    }),
    [characters.data, locations.data, episodes.data, scenes.data, shots.data]
  )

  const allEntities = entityData[kind]

  const options: EntityOption[] = useMemo(() => entitiesByKind(kind, allEntities), [kind, allEntities])

  // Auto-select first entity if none selected.
  useMemo(() => {
    if (options.length > 0 && !selectedId) {
      setSelectedId(options[0]!.id)
    }
  }, [options, selectedId])

  const { data: impact, isLoading, isError } = useEntityImpact(kind, selectedId)

  const isLoadingAny =
    isLoading ||
    characters.isLoading ||
    locations.isLoading ||
    episodes.isLoading ||
    scenes.isLoading ||
    shots.isLoading

  const hasError =
    isError ||
    characters.isError ||
    locations.isError ||
    episodes.isError ||
    scenes.isError ||
    shots.isError

  if (isLoadingAny) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
        <p className="ml-2 text-xs text-mirai-faint">Carregando entidades…</p>
      </div>
    )
  }

  if (hasError) {
    return (
      <ErrorState
        title="Erro ao carregar impacto IP"
        message="Não foi possível carregar as entidades ou o impacto. Tente novamente."
        onRetry={() => {
          characters.refetch()
          locations.refetch()
          episodes.refetch()
          scenes.refetch()
          shots.refetch()
        }}
      />
    )
  }

  const total = impact?.impacts.reduce((acc, e) => acc + e.count, 0) ?? 0

  const needsEpisode = kind === 'SCENE' && episodes.data && episodes.data.length > 0 && !selectedEpisodeForScenes
  const needsScene = kind === 'SHOT' && scenes.data && scenes.data.length > 0 && !selectedSceneForShots

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* ------------------------------------------------------------- header */}
      <header className="border-b border-mirai-border bg-mirai-panel/60 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-mirai-accent" />
          <div>
            <h1 className="text-sm font-display font-bold text-mirai-text tracking-tight">IP Impact</h1>
            <p className="text-[11px] text-mirai-faint">
              Quais entidades reais são tocadas se você editar esta — live counts do banco do projeto.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 min-w-0">
        {/* ------------------------------------------------- entity kind picker */}
        <Card className="mb-5 border border-mirai-border bg-mirai-panel/50">
          <div className="px-4 py-3 border-b border-mirai-border">
            <Label className="mb-2 text-[11px] font-semibold text-mirai-dim uppercase">Tipo de entidade</Label>
            <div className="flex gap-2">
              {IMPACT_KINDS.map((k) => {
                const active = kind === k.value
                return (
                  <button
                    key={k.value}
                    onClick={() => {
                      setKind(k.value)
                      setSelectedId(undefined)
                      setSelectedEpisodeForScenes(null)
                      setSelectedSceneForShots(null)
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      active
                        ? 'bg-mirai-accent text-white border border-mirai-accent/30'
                        : 'border-transparent text-mirai-dim hover:bg-mirai-hover hover:text-mirai-text'
                    }`}
                  >
                    {(() => {
                      const Icon = k.icon
                      return <Icon className={`h-3.5 w-3.5 mr-1.5 ${active ? 'text-white' : 'text-mirai-dim'}`} />
                    })()}
                    {k.label}
                  </button>
                )
              })}
            </div>
          </div>
        </Card>

        {/* ------------------------------------------------- entity picker */}
        <Card className="mb-5 border border-mirai-border bg-mirai-panel/50">
          <div className="px-4 py-3 border-b border-mirai-border">
            <div className="flex items-center justify-between mb-2">
              <Label className="mb-0 text-[11px] font-semibold text-mirai-dim uppercase">Escolher entidade</Label>
              <span className="text-[10px] text-mirai-faint">
                {options.length} {kindLabel(kind)} encontrado{options.length !== 1 ? 's' : ''}
              </span>
            </div>
            {options.length === 0 ? (
              <EmptyState
                icon={<Clock className="h-4 w-4 opacity-50" />}
                title="Nenhuma entidade encontrada"
                description={`Crie ${kindLabel(kind, true)} primeiro em Episodes & Scenes, Locations ou Storyboard.`}
              />
            ) : (
              <div className="space-y-1">
                {options.map((opt) => {
                  const active = opt.id === selectedId
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setSelectedId(opt.id)}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-left transition ${
                        active
                          ? 'bg-mirai-accent text-white border border-mirai-accent/30'
                          : 'text-mirai-text hover:bg-mirai-hover'
                      }`}
                    >
                      <span className="truncate text-sm font-medium">{opt.label}</span>
                      <span className="text-[10px] text-mirai-faint">{opt.id.slice(-6)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </Card>

        {/* ------------------------------------------------- sub-pickers for SCENE / SHOT */}
        {kind === 'SCENE' && needsEpisode && episodes.data && episodes.data.length > 0 && (
          <Card className="mb-5 border border-mirai-border bg-mirai-panel/50">
            <div className="px-4 py-3">
              <Label className="mb-2 text-[11px] font-semibold text-mirai-dim uppercase">Episódio para cenas</Label>
              <Select
                value={(selectedEpisodeForScenes as EpisodeRecord | null)?.id ?? ''}
                onChange={(e) => {
                  const ep = (episodes.data ?? []).find((e2: EpisodeWithStats) => e2.id === e.target.value)
                  setSelectedEpisodeForScenes(ep ?? null)
                  setSelectedId(undefined)
                }}
              >
                {episodes.data!.map((ep) => (
                  <option key={ep.id} value={ep.id}>{`${ep.season}×${ep.number} — ${ep.title}`}</option>
                ))}
              </Select>
            </div>
          </Card>
        )}
        {kind === 'SHOT' && needsScene && scenes.data && scenes.data.length > 0 && (
          <Card className="mb-5 border border-mirai-border bg-mirai-panel/50">
            <div className="px-4 py-3">
              <Label className="mb-2 text-[11px] font-semibold text-mirai-dim uppercase">Cena para shots</Label>
              <Select
                value={(selectedSceneForShots as SceneRecord | null)?.id ?? ''}
                onChange={(e) => {
                  const sc = (scenes.data ?? []).find((s2: SceneRecord) => s2.id === e.target.value)
                  setSelectedSceneForShots(sc ?? null)
                  setSelectedId(undefined)
                }}
              >
                {scenes.data!.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </Select>
            </div>
          </Card>
        )}

        {/* ------------------------------------------------- impact result */}
        {selectedId && (
          <Card className="border border-mirai-border bg-mirai-panel">
            <div className="px-4 py-3 border-b border-mirai-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = KIND_ICON[kind]
                    return <Icon className="h-3.5 w-3.5 text-mirai-accent" />
                  })()}
                  <h2 className="font-display text-sm font-bold text-mirai-text">
                    {total === 0
                      ? 'Sem impactos diretos'
                      : `Impacto: ${total} entidade${total !== 1 ? 's' : ''} tocada${total !== 1 ? 's' : ''}`}
                  </h2>
                </div>
                <Badge tone={total === 0 ? 'neutral' : total > 10 ? 'warn' : 'success'}>
                  {total === 0 ? 'Isolado' : total > 10 ? 'Alto' : 'Baixo'}
                </Badge>
              </div>
            </div>
            <div className="px-4 py-4">
              {impact?.impacts.length === 0 ? (
                <p className="text-xs text-mirai-faint text-center py-4">
                  Esta entidade não é referenciada por nenhuma outra no projeto. Edições nela são seguras isoladamente.
                </p>
              ) : (
                <div className="space-y-2">
                  {impact?.impacts.map((entry) => (
                    <div
                      key={entry.key}
                      className="flex items-center justify-between px-3 py-2 rounded border border-mirai-border/60 bg-mirai-bg/40"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-mirai-accent font-bold">{entry.count}×</span>
                        <span className="text-sm text-mirai-text">{entry.label}</span>
                        {entry.entityIds.length > 0 && (
                          <span
                            className="ml-auto text-[10px] text-mirai-faint truncate max-w-xs"
                            title={entry.entityIds.join(', ')}
                          >
                            {entry.entityIds.map((id) => id.slice(-6)).join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {!selectedId && options.length > 0 && (
          <div className="text-center py-12 text-mirai-faint">
            <p>Selecione uma entidade acima para ver seu impacto real no projeto.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function kindLabel(kind: ImpactKind, indefiniteArticle = false): string {
  const labels: Record<ImpactKind, string> = {
    CHARACTER: 'personagem',
    SCENE: 'cena',
    EPISODE: 'episódio',
    LOCATION: 'localização',
    SHOT: 'shot',
  }
  if (indefiniteArticle) {
    const articles: Record<ImpactKind, string> = {
      CHARACTER: 'um personagem',
      SCENE: 'uma cena',
      EPISODE: 'um episódio',
      LOCATION: 'uma localização',
      SHOT: 'um shot',
    }
    return articles[kind]
  }
  return labels[kind]
}
