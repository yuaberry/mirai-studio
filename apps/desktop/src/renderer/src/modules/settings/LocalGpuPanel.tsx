/**
 * LocalGpuPanel — configure and DIAGNOSE the user's own GPU backend
 * (Automatic1111 / ComfyUI).
 *
 * THE POINT OF THIS PANEL
 * -----------------------
 * The local path is the only way to reach studio-grade anime without paying a
 * cloud provider. It is also the easiest way to destroy an afternoon: a GPU
 * that cannot run the model takes hours and freezes the laptop.
 *
 * So this panel answers "will my machine die trying this?" BEFORE the user
 * clicks generate — by reading the backend's own GPU inventory. When the
 * answer is no, it says exactly what is missing and what the two real escapes
 * are (a cloud provider, or a bigger GPU). It never invents a number, and it
 * never pretends a refusal is a bug.
 */
import { useEffect, useMemo, useState } from 'react'
import { Cpu, RefreshCw, TriangleAlert, Check } from 'lucide-react'
import { REMOTE_LOCAL_WARNING } from '@mirai/shared'
import { useLocalPreflight } from '../../lib/queries'
import { toast } from '../../store/appStore'
import { useT } from '../../lib/i18n'
import { Badge, Button, Input, Label, Select } from '../../system/ui'

function gib(bytes: number | null): string {
  if (bytes === null) return '—'
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
}

/** Is this address the user's own machine? (The remote opt-in only shows otherwise.) */
function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  } catch {
    return false
  }
}

/**
 * The panel for ONE capability (image or video). The settings shape differs
 * between them, so the parent passes the right props rather than the panel
 * guessing.
 */
export function LocalGpuPanel({
  capability,
  protocol,
  baseUrl,
  checkpoint,
  onBaseUrlChange,
  onCheckpointChange,
  remoteOptIn,
  onRemoteOptInChange = () => undefined,
}: {
  capability: 'image' | 'video'
  protocol: string
  baseUrl: string
  checkpoint: string
  onBaseUrlChange: (url: string) => void
  onCheckpointChange: (name: string) => void
  /** Whether the user opted into a REMOTE backend (Colab / ZeroGPU / tunnel). */
  remoteOptIn: boolean
  onRemoteOptInChange?: (on: boolean) => void
}) {
  const tr = useT()
  const isLocal = protocol === 'local'
  // The preflight is only polled when the local protocol is actually selected —
  // it is inert (and silent) for cloud users.
  const preflight = useLocalPreflight(capability, isLocal)

  const gate = preflight.data
  const checkpoints = useMemo(() => gate?.checkpoints ?? [], [gate?.checkpoints])
  const [picked, setPicked] = useState(checkpoint ?? '')

  // The installed list arrives after the first preflight; keep the selection
  // in sync so a reload does not lose the user's choice.
  useEffect(() => {
    if (checkpoints.length > 0 && picked === '') setPicked(checkpoint ?? checkpoints[0]!)
  }, [checkpoints, checkpoint, picked])

  if (!isLocal) return null

  return (
    <div className="mt-3 rounded-md border border-mirai-border bg-mirai-bg/40 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Cpu className="h-3.5 w-3.5 text-mirai-accent" />
        <p className="text-[11px] font-semibold text-mirai-text">{tr('Your GPU')}</p>
        {gate && (
          <Badge tone={gate.ok ? 'success' : 'danger'}>
            {gate.ok ? <Check className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
            {gate.ok ? tr('ready') : tr('cannot run here')}
          </Badge>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          loading={preflight.isFetching}
          onClick={() => void preflight.refetch()}
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {/* ---- the hardware truth, BEFORE the user wastes an hour ---- */}
      {gate && !gate.ok && (
        <div className="mb-2.5 rounded border border-mirai-danger/30 bg-mirai-danger/5 p-2.5">
          <p className="text-[11px] leading-relaxed text-mirai-danger">{gate.reason}</p>
          <p className="mt-1.5 text-[10px] text-mirai-faint">
            {tr('This is a capability check, not a failure — the app refuses instead of freezing your machine.')}
          </p>
        </div>
      )}

      {gate?.ok && gate.gpuName && (
        <p className="mb-2 text-[10px] text-mirai-faint">
          {gate.gpuName} · {tr('free')} {gib(gate.vramFreeBytes)} {tr('of')} {gib(gate.vramTotalBytes)}
        </p>
      )}
      {gate?.ok && gate.gpuName === null && (
        <p className="mb-2 text-[10px] text-mirai-faint">
          {tr('This backend cannot report its VRAM, so the app cannot pre-check it — the generation will simply run.')}
        </p>
      )}

      {/* ---- address ---- */}
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <div>
          <Label htmlFor={`lg-url-${capability}`}>{tr('Local address')}</Label>
          <Input
            id={`lg-url-${capability}`}
            className="h-8 text-xs"
            value={baseUrl}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            placeholder={capability === 'video' ? 'http://127.0.0.1:8188' : 'http://127.0.0.1:7860'}
          />
        </div>
      </div>

      {/* ---- the remote opt-in: free GPU lives on Colab / ZeroGPU Spaces ---- */}
      {!isLoopback(baseUrl) && (
        <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 p-2.5">
          <label className="flex items-start gap-2 text-[11px] leading-relaxed text-amber-300">
            <input
              type="checkbox"
              className="mt-0.5 accent-amber-400"
              checked={remoteOptIn}
              onChange={(e) => onRemoteOptInChange(e.target.checked)}
            />
            <span>{tr('Allow a remote GPU')}</span>
          </label>
          {remoteOptIn ? (
            <p className="mt-1.5 text-[10px] leading-relaxed text-amber-200/80">{REMOTE_LOCAL_WARNING}</p>
          ) : (
            <p className="mt-1.5 text-[10px] leading-relaxed text-amber-200/70">
              {tr('This address is not on this machine, so the app refuses it by default. ')}
              {tr('Free GPU today lives on Google Colab and Hugging Face ZeroGPU — enable the option above to use one.')}
            </p>
          )}
        </div>
      )}

      {/* ---- checkpoints (A1111 only; ComfyUI picks the model in its graph) ---- */}
      {capability === 'image' && checkpoints.length > 0 && (
        <div className="mt-2">
          <Label htmlFor="lg-ckpt">{tr('Anime checkpoint')}</Label>
          <Select
            id="lg-ckpt"
            className="h-8 text-xs"
            value={picked}
            onChange={(e) => {
              setPicked(e.target.value)
              onCheckpointChange(e.target.value)
            }}
          >
            {checkpoints.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[10px] text-mirai-faint">
            {tr('Read live from your backend — these are the models you actually installed.')}
          </p>
        </div>
      )}

      {capability === 'image' && isLocal && checkpoints.length === 0 && !preflight.isFetching && (
        <p className="mt-2 text-[10px] text-mirai-faint">
          {tr('No checkpoints listed — start Automatic1111 with --api and load an anime model, then refresh.')}
        </p>
      )}

      {capability === 'video' && (
        <p className="mt-2 text-[10px] text-mirai-faint">
          {tr('Video runs through your own ComfyUI workflow — paste the “Save (API Format)” JSON below.')}
        </p>
      )}

      {gate && !gate.ok && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => {
            toast({
              kind: 'info',
              title: tr('Cloud path'),
              description: tr(
                'Open the Marketplace, pick a video model, and add its key — the adapter already speaks the protocol.',
              ),
            })
          }}
        >
          {tr('Use a cloud provider instead')}
        </Button>
      )}
    </div>
  )
}