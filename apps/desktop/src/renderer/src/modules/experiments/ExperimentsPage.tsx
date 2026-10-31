/**
 * Creative Experiments (§19) — Generation Lab.
 *
 * Side-by-side variation comparison with promote-to-project.
 * Create experiments around a source entity (shot/scene/page/panel),
 * generate variations (real assets), rate them, and promote the best
 * back into the project — replacing the source entity's asset.
 */
import { useState } from 'react'
import {
  ArrowRight,
  Film,
  Image,
  Music,
  Plus,
  Star,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { Badge, Button, Card, Input, Select, Textarea } from '../../system/ui'
import { EmptyState } from '../../system/EmptyState'
import { Skeleton } from '../../system/Skeleton'
import {
  useExperiments,
  useExperimentMutations,
  useExperimentVariations,
  useExperimentVariationMutations,
  useExperimentPromote,
  useExperimentPromotions,
} from '../../lib/queries'
import { type SourceEntityType } from '@mirai/shared'
import { toast } from '../../store/appStore'

// ------------------------------------------------------------------ constants

const ASSET_KIND_ICON: Record<string, typeof Image> = {
  IMAGE: Image,
  AUDIO: Music,
  VIDEO: Film,
}

const SOURCE_TYPE_LABEL: Record<SourceEntityType, string> = {
  SHOT: 'Shot',
  SCENE: 'Scene',
  PAGE: 'Manga Page',
  PANEL: 'Manga Panel',
}

// ------------------------------------------------------------------ page

export function ExperimentsPage() {
  const { data: experiments, isLoading } = useExperiments()
  const experimentsMutations = useExperimentMutations()
  const [createDialog, setCreateDialog] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newSourceType, setNewSourceType] = useState<SourceEntityType>('SHOT')
  const [newSourceId, setNewSourceId] = useState('')

  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <Skeleton className="h-8 w-32" />
        <p className="mt-4 text-xs text-mirai-faint">Loading experiments…</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* ------------------------------------------------------------- header */}
      <header className="border-b border-mirai-border bg-mirai-panel/60 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-display font-bold text-mirai-text tracking-tight">
            Creative Experiments
          </h1>
          <p className="text-[11px] text-mirai-faint">
            Generation lab — compare variations side by side, promote the best back to your project.
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setNewName('')
            setNewDesc('')
            setNewSourceType('SHOT')
            setNewSourceId('')
            setCreateDialog(true)
          }}
        >
          <Plus className="h-3.5 w-3.5" /> <span className="text-xs">New Experiment</span>
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        { (experiments ?? []).length === 0 ? (
          <EmptyState
            icon={<Wand2 className="h-6 w-6" />}
            title="No experiments yet"
            description="Create your first experiment to generate and compare variations of a shot, scene, page or panel."
          />
        ) : (
          <div className="space-y-3">
            {(experiments ?? []).map((exp) => (
              <ExperimentCard
                key={exp.id}
                experiment={exp}
                onDelete={() => {
                  experimentsMutations.remove.mutate(exp.id, {
                    onSuccess: () => toast({ kind: 'success', title: 'Experiment deleted' }),
                  })
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* --------------------------------------------------- create dialog */}
      {createDialog && (
        <ExperimentCreateDialog
          open={createDialog}
          onClose={() => setCreateDialog(false)}
          name={newName}
          description={newDesc}
          sourceType={newSourceType}
          sourceId={newSourceId}
          onNameChange={setNewName}
          onDescChange={setNewDesc}
          onSourceTypeChange={setNewSourceType}
          onSourceIdChange={setNewSourceId}
          onSubmit={() => {
            experimentsMutations.create.mutate(
              {
                name: newName,
                description: newDesc || undefined,
                sourceEntityType: newSourceType,
                sourceEntityId: newSourceId,
              },
              {
                onSuccess: () => {
                  setCreateDialog(false)
                  toast({ kind: 'success', title: 'Experiment created' })
                },
                onError: (err) =>
                  toast({ kind: 'error', title: 'Create failed', description: err.message }),
              },
            )
          }}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------------- experiment card

interface ExperimentCardProps {
  experiment: import('@mirai/shared').ExperimentRunSummary
  onDelete: () => void
}

function ExperimentCard(props: ExperimentCardProps) {
  const { experiment, onDelete } = props
  const [selected, setSelected] = useState(false)
  const { data: variations, isLoading } = useExperimentVariations(experiment.id)
  const { data: promotions } = useExperimentPromotions(experiment.id)
  const promote = useExperimentPromote()
  const variationMutations = useExperimentVariationMutations()

  const promotedCount = promotions?.length ?? 0
  const variationCount = variations?.length ?? 0

  return (
    <Card className="border border-mirai-border bg-mirai-panel hover:border-mirai-accent/50 transition-colors cursor-pointer group"
      onClick={() => setSelected(!selected)}
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Badge tone="accent">
              {SOURCE_TYPE_LABEL[experiment.sourceEntityType]}
            </Badge>
            <Badge
              tone={experiment.status === 'COMPLETED' ? 'success' : 'neutral'}
            >
              {experiment.status === 'ACTIVE' ? 'Active' : experiment.status === 'COMPLETED' ? 'Completed' : 'Archived'}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-mirai-faint">{variationCount} variations</span>
            {promotedCount > 0 && (
              <span className="text-[10px] text-mirai-success">
                {promotedCount} promoted
              </span>
            )}
          </div>
        </div>
        <h3 className="text-sm font-semibold text-mirai-text truncate">{experiment.name}</h3>
        {experiment.description && (
          <p className="text-[10px] text-mirai-faint line-clamp-1 mt-0.5">
            {experiment.description}
          </p>
        )}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] text-mirai-dim">
            {new Date(experiment.createdAt).toLocaleDateString()}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* --------------------------------------------------- expanded detail */}
      {selected && (
        <div className="border-t border-mirai-border/50 p-4 bg-mirai-bg/30">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-mirai-faint">
              Variations
            </h4>
            {variations && variations.length > 0 && (
              <Badge tone="neutral">
                {variations.length} variation{variations.length === 1 ? '' : 's'}
              </Badge>
            )}
          </div>

          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Skeleton className="h-4 w-24" />
            </div>
          ) : variations && variations.length === 0 ? (
            <p className="text-xs text-mirai-faint text-center py-4">
              No variations yet — generate some from the AI generation tools.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {variations!.map((v) => (
                <VariationCard
                  key={v.id}
                  variation={v}
                  onRate={(score) => {
                    variationMutations.update.mutate(
                      { id: v.id, score },
                      {
                        onSuccess: () =>
                          toast({ kind: 'success', title: `Rated ${score}/5` }),
                      },
                    )
                  }}
                  onPromote={() => {
                    promote.mutate(
                      {
                        experimentId: experiment.id,
                        variationId: v.id,
                        targetEntityType: experiment.sourceEntityType,
                        targetEntityId: experiment.sourceEntityId,
                        targetColumn: 'frame_asset_id',
                      },
                      {
                        onSuccess: () =>
                          toast({
                            kind: 'success',
                            title: 'Variation promoted!',
                            description: 'Asset applied to the source entity.',
                          }),
                        onError: (err) =>
                          toast({ kind: 'error', title: 'Promote failed', description: err.message }),
                      },
                    )
                  }}
                  isPromoted={v.promoted === 1}
                />
              ))}
            </div>
          )}

          {promotions && promotions.length > 0 && (
            <div className="mt-4 pt-4 border-t border-mirai-border/50">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-mirai-faint mb-2">
                Promotions
              </h4>
              <div className="space-y-1">
                {promotions.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-2 py-1.5 rounded bg-mirai-panel/40 border border-mirai-border/40">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-mirai-text">{p.variationId.slice(-6)}</span>
                      <span className="text-[10px] text-mirai-faint">
                        {p.targetEntityType} → {p.targetColumn}
                      </span>
                    </div>
                    <span className="text-[10px] text-mirai-success">
                      {new Date(p.promotedAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// -------------------------------------------------------- variation card

interface VariationCardProps {
  variation: import('@mirai/shared').ExperimentVariationRecord
  onRate: (score: number) => void
  onPromote: () => void
  isPromoted: boolean
}

function VariationCard(props: VariationCardProps) {
  const { variation, onRate, onPromote, isPromoted } = props
  const Icon = ASSET_KIND_ICON[variation.assetKind] || Image

  const assetUrl = variation.assetId
    ? `mirai-asset://${variation.assetId}/`
    : null

  return (
    <Card className="border border-mirai-border/50 bg-mirai-panel/50 p-3 relative group">
      {isPromoted && (
        <Badge tone="success" className="absolute top-2 right-2">
          Promoted
        </Badge>
      )}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-mirai-text truncate">
          {variation.name}
        </h4>
        <Badge
          tone={variation.assetKind === 'IMAGE' ? 'violet' : variation.assetKind === 'AUDIO' ? 'success' : 'info'}
          className="text-[10px]"
        >
          {variation.assetKind}
        </Badge>
      </div>
      <div className="h-32 flex items-center justify-center rounded border border-mirai-border mb-2 bg-mirai-bg">
        {variation.assetId ? (
          <div className="relative w-24 h-24 overflow-hidden rounded-lg bg-mirai-panel">
            <img
              src={assetUrl!}
              alt=""
              className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <Icon className="h-8 w-8 text-mirai-faint" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center">
            <Icon className="h-8 w-8 text-mirai-faint" />
            <span className="mt-1 text-[10px] text-mirai-faint">No asset</span>
          </div>
        )}
      </div>
      {variation.prompt && (
        <p className="text-[10px] text-mirai-faint line-clamp-2 mb-2">
          "{variation.prompt}"
        </p>
      )}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-mirai-dim">
          {variation.generatedBytes > 0 ? (variation.generatedBytes / 1024).toFixed(1) + ' KB' : '—'}
        </span>
        <span className="text-[10px] text-mirai-dim">
          {variation.model || '—'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 cursor-pointer text-[10px] text-mirai-dim group-hover:text-mirai-text">
          Rate:
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              onClick={() => onRate(s)}
              className={`h-5 w-5 rounded ${variation.score === s ? 'bg-mirai-accent text-[#0a0c10]' : 'text-mirai-dim hover:text-mirai-accent'} flex items-center justify-center`}
            >
              <Star className="h-3 w-3 fill-current" />
            </button>
          ))}
        </label>
        {variation.score && (
          <span className="text-xs text-mirai-accent font-semibold">
            {variation.score}/5
          </span>
        )}
      </div>
      {variation.assetId && !isPromoted ? (
        <Button
          size="sm"
          variant="outline"
          onClick={onPromote}
          className="w-full text-[10px] px-2"
        >
          <ArrowRight className="h-3 w-3" /> Promote
        </Button>
      ) : null}
    </Card>
  )
}

// ------------------------------------------------------- create dialog

interface ExperimentCreateDialogProps {
  open: boolean
  onClose: () => void
  name: string
  description: string
  sourceType: SourceEntityType
  sourceId: string
  onNameChange: (v: string) => void
  onDescChange: (v: string) => void
  onSourceTypeChange: (v: SourceEntityType) => void
  onSourceIdChange: (v: string) => void
  onSubmit: () => void
}

function ExperimentCreateDialog(props: ExperimentCreateDialogProps) {
  const {
    open, onClose, name, description, sourceType, sourceId,
    onNameChange, onDescChange, onSourceTypeChange, onSourceIdChange, onSubmit,
  } = props

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <Card className="w-full max-w-lg p-0 relative z-[61]">
        <div className="px-4 py-3 border-b border-mirai-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-mirai-text">New Experiment</h3>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="px-4 py-4 space-y-4">
          <div>
            <Label htmlFor="exp-name">Name</Label>
            <Input
              id="exp-name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="e.g. Keyframe style test for shot 42"
            />
          </div>
          <div>
            <Label htmlFor="exp-desc">Description (optional)</Label>
            <Textarea
              id="exp-desc"
              value={description}
              onChange={(e) => onDescChange(e.target.value)}
              rows={2}
              placeholder="What are you testing? Lighting, mood, camera angle…"
            />
          </div>
          <div>
            <Label htmlFor="exp-source-type">Source Entity Type</Label>
            <Select
              id="exp-source-type"
              value={sourceType}
              onChange={(e) => onSourceTypeChange(e.target.value as SourceEntityType)}
            >
              <option value="SHOT">Shot (storyboard)</option>
              <option value="SCENE">Scene</option>
              <option value="PAGE">Manga Page</option>
              <option value="PANEL">Manga Panel</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="exp-source-id">Source Entity ID</Label>
            <Input
              id="exp-source-id"
              value={sourceId}
              onChange={(e) => onSourceIdChange(e.target.value)}
              placeholder="Paste the shot/scene/page/panel ULID here"
            />
            <p className="mt-1 text-[10px] text-mirai-faint">
              Find the ID in the Storyboard, Manga Studio or Overview panels.
            </p>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-mirai-border/50 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!name || !sourceId} onClick={onSubmit}>
            <Wand2 className="h-3.5 w-3.5" /> Create
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ helpers

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-mirai-dim">
      {children}
    </label>
  )
}
