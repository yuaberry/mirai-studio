/**
 * CharacterSheet (v0.31) — the character's REFERENCE SHEET: the canonical
 * visual anchor of the AI-anime recipe. Import a real file or generate the
 * AI turnaround (front/side/back + expressions); the sheet is a normal
 * project asset — shown here, pruned honestly, anchoring the pipeline.
 */
import { ImagePlus, Sparkles, Trash2, UserSquare2 } from 'lucide-react'
import { MiraiError, type CharacterRecord } from '@mirai/shared'
import { Button } from '../../system/ui'
import { useAttachReference, useClearReference, useGenerateCharacterSheet } from '../../lib/queries'
import { assetUrl } from '../../lib/queries'
import { toast } from '../../store/appStore'
import { T } from '../../system/T'

export function CharacterSheet({ character }: { character: CharacterRecord }) {
  const attach = useAttachReference()
  const clear = useClearReference()
  const generate = useGenerateCharacterSheet()

  const onAttach = () =>
    attach.mutate(character.id, {
      onSuccess: () => toast({ kind: 'success', title: 'Reference sheet attached' }),
      onError: (err) => {
        if (err instanceof MiraiError && err.code === 'CANCELLED') return
        toast({ kind: 'error', title: 'Import failed', description: err.message })
      },
    })

  const onGenerate = () =>
    generate.mutate(character.id, {
      onSuccess: () =>
        toast({
          kind: 'success',
          title: 'AI reference sheet generated',
          description: 'Front/side/back turnaround + expressions — check it against your vision.',
        }),
      onError: (err) => toast({ kind: 'error', title: 'Sheet generation failed', description: err.message }),
    })

  return (
    <div className="rounded-lg border border-mirai-border bg-mirai-panel/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-display text-[11px] font-bold tracking-[0.16em] text-mirai-text uppercase">
          <UserSquare2 className="h-3.5 w-3.5 text-mirai-accent" /> <T k="Reference sheet" />
        </h3>
        <span className="text-[10px] text-mirai-faint">
          the canonical visual anchor — frames and clips must honor it
        </span>
      </div>

      <div className="flex items-start gap-4">
        {character.referenceAssetId ? (
          <img
            src={assetUrl(character.referenceAssetId)}
            alt={`${character.name} reference sheet`}
            className="max-h-64 rounded-md border border-mirai-border-strong"
          />
        ) : (
          <div className="flex h-32 w-24 items-center justify-center rounded-md border border-dashed border-mirai-border-strong text-mirai-faint">
            <UserSquare2 className="h-8 w-8" />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Button size="sm" variant="outline" loading={attach.isPending} onClick={onAttach}>
            <ImagePlus className="h-3.5 w-3.5" /> <T k="Import sheet" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={generate.isPending}
            title="AI generates a front/side/back turnaround from this character + the Style Bible"
            onClick={onGenerate}
          >
            <Sparkles className="h-3.5 w-3.5" /> <T k="AI sheet" />
          </Button>
          {character.referenceAssetId ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                clear.mutate(character.id, {
                  onSuccess: () => toast({ kind: 'success', title: 'Reference sheet removed' }),
                  onError: (err) => toast({ kind: 'error', title: 'Remove failed', description: err.message }),
                })
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
