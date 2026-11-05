/**
 * Asset Intelligence (§14) — visualizador de uso e grafo de dependências
 * de assets. Tudo é fato observado no banco: quem usa qual asset, quando,
 * e como os assets dependem uns dos outros.
 *
 * Design: dark studio UI, sakura-pink → violet → cyan accents,
 * SVG force-directed-style graph, usage history table.
 */
import { useMemo, useState } from 'react'
import {
  ArrowRight,
  Circle,
  Database,
  Image,
  Music,
  Video,
  Film,
  Link,
  Share2,
  Clock,
  BarChart3,
} from 'lucide-react'
import { Button, Card, PageHeader, Separator } from '../../system/ui'
import { EmptyState } from '../../system/EmptyState'
import { Skeleton } from '../../system/Skeleton'
import {
  useAssetGraph,
  useAssetUsageHistory,
  useAssetDependencies,
  useAssetIntelligence,
} from '../../lib/queries'
import { invoke } from '../../lib/ipc'
import { toast } from '../../store/appStore'

// ------------------------------------------------------------------ constants

const ASSET_COLOR: Record<string, string> = {
  IMAGE: '#c084fc',    // violet
  AUDIO: '#34d399',    // emerald
  VIDEO: '#60a5fa',    // blue
  BLENDER: '#fbbf24',  // amber
}

const ASSET_ICON: Record<string, typeof Image> = {
  IMAGE: Image,
  AUDIO: Music,
  VIDEO: Video,
  BLENDER: Film,
}

const GRAPH_WIDTH = 700
const GRAPH_HEIGHT = 420
const NODE_R = 28

// ------------------------------------------------------------------ page

export function AssetIntelligencePage() {
  const { data: graph, isLoading: graphLoading } = useAssetGraph()
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)

  // Hooks must be called unconditionally — use `enabled` to gate execution.
  const historyQuery = useAssetUsageHistory(selectedAssetId ?? undefined)
  const dependenciesQuery = useAssetDependencies(selectedAssetId ?? undefined)
  const intelligenceQuery = useAssetIntelligence(selectedAssetId ?? undefined)

  const history = historyQuery.data ?? []
  const dependencies = dependenciesQuery.data ?? []
  const intelligence = intelligenceQuery.data ?? null

  const assets = useMemo(() => graph?.nodes ?? [], [graph])
  const edges = useMemo(() => graph?.edges ?? [], [graph])

  // Layout: simple circular layout for readability
  const nodePos = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>()
    const n = assets.length
    if (n === 0) return pos
    const radius = Math.min(GRAPH_WIDTH, GRAPH_HEIGHT) * 0.35
    const cx = GRAPH_WIDTH / 2
    const cy = GRAPH_HEIGHT / 2
    assets.forEach((a, i) => {
      const angle = (i / n) * 2 * Math.PI
      pos.set(a.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) })
    })
    return pos
  }, [assets])

  if (graphLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <Skeleton className="h-8 w-32" />
        <p className="mt-4 text-xs text-mirai-faint">Loading asset graph…</p>
      </div>
    )
  }

  if (assets.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="No assets yet"
          description="Import frames, audio, video or manga panel art — then see how they connect here."
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Asset Intelligence"
        subtitle={`${assets.length} assets · ${edges.length} dependencies · usage history tracked`}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void invoke('assets:graph', {})
              toast({ kind: 'success', title: 'Graph refreshed' })
            }}
          >
            <ArrowRight className="h-3.5 w-3.5" /> <span className="text-xs">Refresh</span>
          </Button>
        }
      />
      <Separator />

      <div className="flex flex-1 overflow-hidden">
        {/* ------------------------------------------------------------- left: graph */}
        <div className="flex-1 min-w-0 border-r border-mirai-border bg-mirai-bg p-6 overflow-y-auto">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-mirai-faint">
              Dependency Graph
            </h2>
            <p className="text-[10px] text-mirai-faint">
              Nodes = assets · edges = dependencies
            </p>
          </div>
          <div className="relative">
            <svg
              width={GRAPH_WIDTH}
              height={GRAPH_HEIGHT}
              className="bg-mirai-panel rounded-xl border border-mirai-border/50"
            >
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="7"
                  refX="9"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
                </marker>
              </defs>

              {/* edges */}
              {edges.map((edge) => {
                const s = nodePos.get(edge.source)
                const t = nodePos.get(edge.target)
                if (!s || !t) return null
                const mx = (s.x + t.x) / 2
                const my = (s.y + t.y) / 2 - 40
                return (
                  <path
                    key={edge.source + '-' + edge.target}
                    d={`M${s.x},${s.y} Q${mx},${my} ${t.x},${t.y}`}
                    fill="none"
                    stroke="#475569"
                    strokeWidth="1.5"
                    markerEnd="url(#arrowhead)"
                    className="transition-all hover:stroke-mirai-accent/50"
                  />
                )
              })}

              {/* nodes */}
              {assets.map((asset) => {
                const pos = nodePos.get(asset.id)!
                const kindColor = ASSET_COLOR[asset.kind] ?? '#94a3b8'
                const isSelected = selectedAssetId === asset.id
                return (
                  <g
                    key={asset.id}
                    onClick={() => setSelectedAssetId(asset.id)}
                    className="cursor-pointer"
                    transform={`translate(${pos.x - NODE_R},${pos.y - NODE_R})`}
                  >
                    <circle
                      cx={NODE_R}
                      cy={NODE_R}
                      r={NODE_R}
                      fill={kindColor}
                      fillOpacity={isSelected ? 1 : 0.9}
                      stroke="#ffffff"
                      strokeWidth={isSelected ? 3 : 2}
                      className="transition-all hover:fill-opacity-100"
                    />
                    <text
                      x={NODE_R}
                      y={NODE_R + 6}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="10"
                      fontWeight="bold"
                      className="pointer-events-none"
                    >
                      {asset.id.slice(-6)}
                    </text>
                    <text
                      x={NODE_R}
                      y={NODE_R + 18}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.7)"
                      fontSize="9"
                      className="pointer-events-none"
                    >
                      {asset.kind}
                    </text>
                    <circle
                      cx={NODE_R}
                      cy={NODE_R - 10}
                      r={6}
                      fill={kindColor}
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                  </g>
                )
              })}
            </svg>
          </div>

          {/* legend */}
          <div className="mt-4 flex flex-wrap gap-3 text-[10px] text-mirai-faint">
            {Object.entries(ASSET_COLOR).map(([kind, color]) => (
              <span key={kind} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                {kind}
              </span>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------------------- right: details */}
        <div className="w-80 min-w-0 border-l border-mirai-border bg-mirai-panel/50 flex flex-col">
          {selectedAssetId ? (
            <AssetDetailPanel
              assetId={selectedAssetId}
              history={history}
              dependencies={dependencies}
              intelligence={intelligence}
              onClear={() => setSelectedAssetId(null)}
            />
          ) : (
            <AssetEmptyPanel />
          )}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ panels

function AssetEmptyPanel() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <Circle className="h-10 w-10 text-mirai-faint" />
      <h3 className="mt-3 text-sm font-semibold text-mirai-text">Select an asset</h3>
      <p className="mt-1 text-xs text-mirai-faint">
        Click a node in the graph to see its usage history and dependencies.
      </p>
    </div>
  )
}

interface AssetDetailPanelProps {
  assetId: string
  history: Array<{ contextKind: string; contextId: string; contextRole: string | null; usedAt: string }>
  dependencies: Array<{ targetAssetId: string; relation: string }>
  intelligence: { usageCount: number; firstUsedAt: string | null; lastUsedAt: string | null } | null
  onClear: () => void
}

function AssetDetailPanel(props: AssetDetailPanelProps) {
  const { assetId, history, dependencies, intelligence, onClear } = props

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AssetKindIcon kind={history[0]?.contextKind ?? 'IMAGE'} />
          <div>
            <h3 className="text-sm font-semibold text-mirai-text truncate max-w-[160px]">
              Asset {assetId.slice(-8)}
            </h3>
            <p className="text-[10px] text-mirai-faint uppercase tracking-wider">ASSET</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onClear}>
          <Share2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="h-[1px] bg-mirai-border my-4" />

      {/* stats cards */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatCard
          label="Uses"
          value={intelligence?.usageCount ?? 0}
          icon={<BarChart3 className="h-4 w-4" />}
          color="#c084fc"
        />
        <StatCard
          label="Last used"
          value={
            intelligence?.lastUsedAt
              ? new Date(intelligence.lastUsedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })
              : '—'
          }
          icon={<Clock className="h-4 w-4" />}
          color="#60a5fa"
        />
      </div>

      {/* dependencies */}
      <div className="mb-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-mirai-faint mb-2 flex items-center gap-1">
          <Link className="h-3 w-3" /> Depends On
        </h4>
        {dependencies.length === 0 ? (
          <p className="text-xs text-mirai-faint">No dependencies — this asset is a source.</p>
        ) : (
          <div className="space-y-1">
            {dependencies.map((dep) => (
              <div key={dep.targetAssetId + dep.relation} className="flex items-center justify-between px-2 py-1.5 rounded bg-mirai-bg/40 border border-mirai-border/40">
                <span className="text-xs text-mirai-text">{dep.targetAssetId.slice(-6)}</span>
                <span className="text-[10px] text-mirai-faint">{dep.relation}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* usage history */}
      <div className="flex-1 min-h-0">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-mirai-faint mb-2 flex items-center gap-1">
          <Database className="h-3 w-3" /> Used In
        </h4>
        {history.length === 0 ? (
          <p className="text-xs text-mirai-faint">No usage recorded yet.</p>
        ) : (
          <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
            {history.map((h, i) => (
              <div key={i} className="flex items-center justify-between px-2 py-1.5 rounded bg-mirai-bg/40 border border-mirai-border/40">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-mirai-text">{h.contextKind}</span>
                  <span className="text-[10px] text-mirai-faint">
                    {h.contextId.slice(-6)} {h.contextRole ? `· ${h.contextRole}` : ''}
                  </span>
                </div>
                <span className="text-[10px] text-mirai-faint">
                  {new Date(h.usedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard(props: {
  label: string
  value: string | number
  icon: React.ReactNode
  color: string
}) {
  return (
    <Card className="bg-mirai-bg/40 border border-mirai-border/50">
      <div className="px-3 py-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-mirai-faint uppercase">{props.label}</p>
            <p className="text-sm font-semibold text-mirai-text">{props.value}</p>
          </div>
          <div className={`p-1 rounded bg-[${props.color}]/10 text-${props.color === '#c084fc' ? 'violet' : 'blue'}-500`}>
            {props.icon}
          </div>
        </div>
      </div>
    </Card>
  )
}

function AssetKindIcon(props: { kind: string }) {
  const Icon = ASSET_ICON[props.kind] || Image
  const color = ASSET_COLOR[props.kind] || '#94a3b8'
  const textColor = props.kind === 'IMAGE' ? 'violet-500' : props.kind === 'AUDIO' ? 'emerald-500' : props.kind === 'VIDEO' ? 'blue-500' : 'amber-500'
  return (
    <div className={`p-1.5 rounded bg-[${color}]/20 text-${textColor}`}>
      <Icon className="h-4 w-4" />
    </div>
  )
}
