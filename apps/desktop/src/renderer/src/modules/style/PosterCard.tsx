/**
 * PosterCard (v0.28, §7 Visual Dev Lab slice 2) — the project's key
 * visual, generated from LIVING data: title + genres from the manifest,
 * the moodboard palette as the color script (with per-project hue
 * fallback), the author's tagline (AI can propose 3 — picking stays
 * human). Live SVG preview; export to exports/poster/.
 */
import { useState } from 'react'
import { Clapperboard, Download, Sparkles, Wand2 } from 'lucide-react'
import { Badge, Button, Label, Textarea } from '../../system/ui'
import { EmptyState } from '../../system/EmptyState'
import {
  usePoster,
  usePosterSave,
  usePosterExport,
  usePosterReveal,
  useTaglinesDraft,
} from '../../lib/queries'
import { toast } from '../../store/appStore'
import { T } from '../../system/T'

export function PosterCard() {
  const { data: poster, isLoading, isError } = usePoster()
  const save = usePosterSave()
  const exportPoster = usePosterExport()
  const reveal = usePosterReveal()
  const taglines = useTaglinesDraft()

  const [taglineDraft, setTaglineDraft] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<string[]>([])

  const taglineValue = taglineDraft ?? poster?.tagline ?? ''

  const saveTagline = (value: string) => {
    save.mutate(
      { tagline: value.trim() || undefined },
      {
        onSuccess: () => toast({ kind: 'success', title: 'Tagline saved' }),
        onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
      },
    )
  }

  return (
    <div className="rounded-lg border border-mirai-border bg-mirai-panel/40 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-display text-[11px] font-bold tracking-[0.16em] text-mirai-text uppercase">
            <Clapperboard className="h-3.5 w-3.5 text-mirai-accent" /> <T k="Poster Studio" />
          </h2>
          <p className="mt-1 text-[11px] text-mirai-faint">
            the key visual of the work — title, genres and the moodboard palette, composed live
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            title="Reveal the exported poster in the file manager"
            onClick={() =>
              reveal.mutate(undefined, {
                onError: (err) => toast({ kind: 'error', title: 'Reveal failed', description: err.message }),
              })
            }
          >
            ↗
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={exportPoster.isPending}
            title="Export the poster as SVG to exports/poster/"
            onClick={() =>
              exportPoster.mutate(undefined, {
                onSuccess: (r) =>
                  toast({ kind: 'success', title: 'Poster exported', description: r.path }),
                onError: (err) =>
                  toast({ kind: 'error', title: 'Export failed', description: err.message }),
              })
            }
          >
            <Download className="h-3.5 w-3.5" /> <T k="Export poster" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <EmptyState icon={<Clapperboard className="h-5 w-5" />} title="Composing the poster…" className="min-h-24" />
      ) : isError || !poster ? (
        <EmptyState icon={<Clapperboard className="h-5 w-5" />} title="Poster failed to compose" className="min-h-24" />
      ) : (
        <div className="flex flex-col gap-4 md:flex-row">
          {/* live preview — the SVG as a data URI (sandboxed render) */}
          <div className="mx-auto w-52 shrink-0 overflow-hidden rounded-lg border border-mirai-border-strong shadow-xl shadow-black/40 md:mx-0">
            <img
              src={`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(poster.svg)))}`}
              alt="project poster preview"
              className="block w-full"
            />
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <Label htmlFor="po-tagline">
                <T k="Tagline" /> <span className="font-normal text-mirai-faint">the italic line under the title</span>
              </Label>
              <Textarea
                id="po-tagline"
                rows={2}
                className="text-xs"
                placeholder="The promise the poster whispers…"
                value={taglineValue}
                onChange={(e) => setTaglineDraft(e.target.value)}
                onBlur={() => taglineDraft !== null && saveTagline(taglineDraft)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                loading={taglines.isPending}
                title="AI proposes 3 taglines from your Story Bible — you pick"
                onClick={() =>
                  taglines.mutate(undefined, {
                    onSuccess: (r) => setCandidates(r.taglines),
                    onError: (err) =>
                      toast({ kind: 'error', title: 'Tagline draft failed', description: err.message }),
                  })
                }
              >
                <Wand2 className="h-3.5 w-3.5" /> <T k="AI: 3 taglines" />
              </Button>
              {poster.palette.length > 0 ? (
                <span className="ml-auto flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold tracking-wider text-mirai-faint uppercase">
                    <T k="Color script" />
                  </span>
                  <span className="flex h-4 overflow-hidden rounded-full border border-mirai-border-strong">
                    {poster.palette.slice(0, 8).map((color, i) => (
                      <span key={i} className="h-full w-5" style={{ backgroundColor: color }} title={color} />
                    ))}
                  </span>
                  <Badge tone="violet">{poster.width}×{poster.height}</Badge>
                </span>
              ) : null}
            </div>

            {candidates.length > 0 ? (
              <div className="space-y-1.5 rounded-md border border-mirai-accent/30 bg-mirai-accent/5 p-3">
                <p className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-mirai-accent uppercase">
                  <Sparkles className="h-3 w-3" /> <T k="AI candidates — pick one" />
                </p>
                {candidates.map((candidate, i) => (
                  <button
                    key={i}
                    className="block w-full rounded border border-mirai-border/70 bg-mirai-bg/50 px-3 py-2 text-left text-xs text-mirai-dim italic transition-colors hover:border-mirai-accent/50 hover:text-mirai-text"
                    onClick={() => {
                      setTaglineDraft(candidate)
                      setCandidates([])
                      saveTagline(candidate)
                    }}
                  >
                    “{candidate}”
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
