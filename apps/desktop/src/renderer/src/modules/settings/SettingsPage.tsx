/**
 * Settings — General, AI (OpenRouter credentials + live model catalog),
 * appearance, shortcuts reference.
 */
import { useEffect, useState } from 'react'
import { RefreshCw, Save, Search } from 'lucide-react'
import { MiraiError, type AppSettings } from '@mirai/shared'
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  actionsBoundTo,
  effectiveShortcuts,
  isValidCombo,
  prettyCombo,
} from '@mirai/shared'
import { comboFromEvent } from '../../lib/shortcuts'
import { cn } from '../../lib/utils'
import { Badge, Button, Card, Input, Label, SectionTitle, Select, Spinner } from '../../system/ui'
import { ErrorState } from '../../system/EmptyState'
import { Kbd } from '../../system/ui'
import {
  useSettings,
  useUpdateSettings,
  useCredentialsStatus,
  useSetCredential,
  useClearCredential,
  useAiModels,
  useAiStatus,
} from '../../lib/queries'
import { toast } from '../../store/appStore'

export function SettingsPage() {
  const { data: settings, isLoading, isError, error, refetch } = useSettings()

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }
  if (isError || !settings) {
    return (
      <ErrorState
        title="Settings failed to load"
        message={error instanceof MiraiError ? error.message : 'Unknown error'}
        onRetry={() => void refetch()}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-10">
      <h1 className="mb-8 font-display text-2xl font-bold text-mirai-text">Settings</h1>
      <div className="space-y-6">
        <GeneralCard settings={settings} />
        <ProvidersCard />
        <ShortcutsCard />
      </div>
    </div>
  )
}

function GeneralCard({ settings }: { settings: AppSettings }) {
  const update = useUpdateSettings()
  const [locale, setLocale] = useState<string>(settings.general.locale)
  const [autosave, setAutosave] = useState(String(settings.general.autosaveIntervalMs))
  const [confirmDestructive, setConfirmDestructive] = useState(settings.general.confirmDestructive)

  const save = () =>
    update.mutate(
      {
        ...settings,
        general: {
          locale: locale as AppSettings['general']['locale'],
          autosaveIntervalMs: Number(autosave) || 5000,
          confirmDestructive,
        },
      },
      {
        onSuccess: () => toast({ kind: 'success', title: 'Settings saved' }),
        onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
      },
    )

  return (
    <Card className="p-5">
      <SectionTitle>General</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="st-locale">Interface language</Label>
          <Select id="st-locale" value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="en">English</option>
            <option value="pt-BR">Português (BR)</option>
            <option value="ja">日本語</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="st-autosave">Autosave interval (ms)</Label>
          <Input
            id="st-autosave"
            inputMode="numeric"
            value={autosave}
            onChange={(e) => setAutosave(e.target.value)}
          />
          <p className="mt-1 text-[10px] text-mirai-faint">Editors autosave draft state (Story Bible today, more in Phase 1+).</p>
        </div>
        <div className="col-span-2 flex items-center justify-between rounded-lg border border-mirai-border bg-mirai-panel px-4 py-3">
          <div>
            <p className="text-xs font-semibold text-mirai-text">Confirm destructive actions</p>
            <p className="text-[11px] text-mirai-dim">Ask before anything irreversible.</p>
          </div>
          <Button
            size="sm"
            variant={confirmDestructive ? 'outline' : 'ghost'}
            onClick={() => setConfirmDestructive((v) => !v)}
          >
            {confirmDestructive ? 'On' : 'Off'}
          </Button>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="primary" loading={update.isPending} onClick={save}>
          <Save className="h-4 w-4" /> Save General
        </Button>
      </div>
    </Card>
  )
}

function ProvidersCard() {
  const { data: credentials, isLoading } = useCredentialsStatus()
  const { data: aiStatus } = useAiStatus()
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const setCredential = useSetCredential()
  const clearCredential = useClearCredential()
  const { data: models, isLoading: modelsLoading, refetch: refetchModels } = useAiModels()

  const [openrouterKey, setOpenrouterKey] = useState('')
  const [nvidiaKey, setNvidiaKey] = useState('')
  const [imageKey, setImageKey] = useState('')
  const [nvidiaModel, setNvidiaModel] = useState(settings?.ai.nvidia.model ?? 'nvidia/z-ai/glm-5.3')
  const [imageBaseUrl, setImageBaseUrl] = useState(settings?.ai.image.baseUrl ?? '')
  const [imageModel, setImageModel] = useState(settings?.ai.image.model ?? '')
  const [imageSize, setImageSize] = useState(settings?.ai.image.size ?? '1344x768')

  useEffect(() => {
    if (settings) {
      setNvidiaModel(settings.ai.nvidia.model)
      setImageBaseUrl(settings.ai.image.baseUrl ?? '')
      setImageModel(settings.ai.image.model ?? '')
      setImageSize(settings.ai.image.size)
    }
  }, [settings?.ai.nvidia.model, settings?.ai.nvidia.baseUrl, settings?.ai.image.baseUrl, settings?.ai.image.model, settings?.ai.image.size]) // eslint-disable-line react-hooks/exhaustive-deps

  const cred = (key: string) => credentials?.find((c) => c.key === key)

  const saveKey = (key: 'openrouter' | 'nvidia' | 'image', value: string, clear: () => void) => {
    if (!value.trim()) {
      toast({ kind: 'warning', title: 'Paste the key first' })
      return
    }
    setCredential.mutate(
      { key, value: value.trim() },
      {
        onSuccess: (secure) => {
          clear()
          toast({
            kind: secure ? 'success' : 'warning',
            title: `${key === 'nvidia' ? 'NVIDIA' : key === 'image' ? 'Image provider' : 'OpenRouter'} key stored`,
            description: secure
              ? 'Encrypted with your OS keychain.'
              : 'Stored WITHOUT encryption — OS secure storage unavailable.',
          })
        },
        onError: (err) => toast({ kind: 'error', title: 'Failed to store key', description: err.message }),
      },
    )
  }

  const saveProviderPrefs = (patch: Record<string, unknown>) => {
    if (!settings) return
    updateSettings.mutate(
      { ...settings, ai: { ...settings.ai, ...patch } },
      {
        onSuccess: () => toast({ kind: 'success', title: 'Provider preferences saved' }),
        onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
      },
    )
  }

  return (
    <Card className="p-5">
      <SectionTitle
        right={
          isLoading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <Badge tone={aiStatus?.configured ? 'success' : 'neutral'}>
              {aiStatus ? `chat: ${aiStatus.provider}` : 'not configured'}
            </Badge>
          )
        }
      >
        Providers
      </SectionTitle>

      {/* -------------------------------------------- chat provider choice */}
      <p className="mb-3 text-xs leading-relaxed text-mirai-dim">
        Choose who powers chat, screenplay drafting and future text agents. Both are
        OpenAI-compatible; keys are encrypted and never leave this machine except to call the
        provider you pick.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <button
          onClick={() => saveProviderPrefs({ chatProvider: 'openrouter' })}
          className={`rounded-lg border p-3 text-left transition-colors ${
            settings?.ai.chatProvider === 'openrouter'
              ? 'border-mirai-accent/40 bg-mirai-accent/10'
              : 'border-mirai-border bg-mirai-panel hover:border-mirai-border-strong'
          }`}
        >
          <p className="text-xs font-semibold text-mirai-text">OpenRouter</p>
          <p className="mt-0.5 text-[10px] text-mirai-faint">many models, free-tier discovery</p>
          <p className="mt-1 text-[10px] text-mirai-accent-3">
            {cred('openrouter')?.configured ? 'key stored' : 'no key'}
          </p>
        </button>
        <button
          onClick={() => saveProviderPrefs({ chatProvider: 'nvidia' })}
          className={`rounded-lg border p-3 text-left transition-colors ${
            settings?.ai.chatProvider === 'nvidia'
              ? 'border-mirai-success/40 bg-mirai-success/10'
              : 'border-mirai-border bg-mirai-panel hover:border-mirai-border-strong'
          }`}
        >
          <p className="text-xs font-semibold text-mirai-text">NVIDIA NIM (GLM)</p>
          <p className="mt-0.5 text-[10px] text-mirai-faint">your NVIDIA endpoint & GLM model</p>
          <p className="mt-1 text-[10px] text-mirai-accent-3">
            {cred('nvidia')?.configured ? 'key stored' : 'no key'}
          </p>
        </button>
      </div>

      {/* -------------------------------------------------- provider blocks */}
      <div className="space-y-5">
        {/* OpenRouter */}
        <div className="rounded-lg border border-mirai-border bg-mirai-panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-mirai-text">OpenRouter key</p>
            {cred('openrouter')?.configured && (
              <Button
                size="sm"
                variant="ghost"
                loading={clearCredential.isPending}
                onClick={() =>
                  clearCredential.mutate('openrouter', {
                    onSuccess: () => toast({ kind: 'success', title: 'Key removed' }),
                  })
                }
              >
                Remove
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder={cred('openrouter')?.configured ? 'Replace stored key…' : 'sk-or-v1-…'}
              value={openrouterKey}
              onChange={(e) => setOpenrouterKey(e.target.value)}
            />
            <Button
              variant="primary"
              className="shrink-0"
              loading={setCredential.isPending}
              onClick={() => saveKey('openrouter', openrouterKey, () => setOpenrouterKey(''))}
            >
              Save
            </Button>
          </div>
          {settings?.ai.chatProvider === 'openrouter' && (
            <div className="mt-3">
              <Label htmlFor="pv-ormodel">Default model</Label>
              <Select
                id="pv-ormodel"
                className="h-8 text-xs"
                value={settings.ai.defaultModel ?? ''}
                onChange={(e) => saveProviderPrefs({ defaultModel: e.target.value || undefined })}
                disabled={modelsLoading}
              >
                <option value="">{modelsLoading ? 'Loading catalog…' : '— choose a model —'}</option>
                {(models?.models ?? [])
                  .slice()
                  .sort((a, b) => Number(b.isFree) - Number(a.isFree) || a.id.localeCompare(b.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.isFree ? 'FREE · ' : ''}
                      {m.id}
                      {m.contextLength ? ` · ${Math.round(m.contextLength / 1000)}k` : ''}
                    </option>
                  ))}
              </Select>
              <div className="mt-1.5 flex items-center justify-between">
                <p className="text-[10px] text-mirai-faint">
                  {models
                    ? `${models.models.length} models · ${models.models.filter((m) => m.isFree).length} free · ${models.cached ? 'cached' : 'live'}`
                    : 'catalog needs connection'}
                </p>
                <Button size="sm" variant="ghost" loading={modelsLoading} onClick={() => void refetchModels()}>
                  <RefreshCw className="h-3 w-3" /> Refresh
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* NVIDIA NIM (GLM) */}
        <div className="rounded-lg border border-mirai-border bg-mirai-panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-mirai-text">
              NVIDIA NIM key
              <span className="ml-2 font-normal text-mirai-faint">build.nvidia.com</span>
            </p>
            {cred('nvidia')?.configured && (
              <Button
                size="sm"
                variant="ghost"
                loading={clearCredential.isPending}
                onClick={() =>
                  clearCredential.mutate('nvidia', {
                    onSuccess: () => toast({ kind: 'success', title: 'Key removed' }),
                  })
                }
              >
                Remove
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="nvapi-…"
              value={nvidiaKey}
              onChange={(e) => setNvidiaKey(e.target.value)}
            />
            <Button
              variant="primary"
              className="shrink-0"
              loading={setCredential.isPending}
              onClick={() => saveKey('nvidia', nvidiaKey, () => setNvidiaKey(''))}
            >
              Save
            </Button>
          </div>
          {settings?.ai.chatProvider === 'nvidia' && (
            <div className="mt-3">
              <Label htmlFor="pv-glmodel">
                GLM model id
                <span className="ml-1 font-normal text-mirai-faint">(NVIDIA catalog id)</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="pv-glmodel"
                  className="h-8 text-xs"
                  value={nvidiaModel}
                  onChange={(e) => setNvidiaModel(e.target.value)}
                  placeholder="nvidia/z-ai/glm-5.3"
                />
                <Button
                  size="sm"
                  variant="primary"
                  className="shrink-0"
                  loading={updateSettings.isPending}
                  disabled={nvidiaModel.trim() === (settings?.ai.nvidia.model ?? '')}
                  onClick={() => saveProviderPrefs({ nvidia: { ...settings!.ai.nvidia, model: nvidiaModel.trim() } })}
                >
                  Save
                </Button>
              </div>
              <p className="mt-1 text-[10px] text-mirai-faint">
                Endpoint: {settings?.ai.nvidia.baseUrl}
              </p>
            </div>
          )}
        </div>

        {/* Image provider */}
        <div className="rounded-lg border border-mirai-border bg-mirai-panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-mirai-text">
              Image provider
              <span className="ml-2 font-normal text-mirai-faint">OpenAI Images-compatible</span>
            </p>
            <Badge tone={aiStatus?.imageConfigured ? 'success' : 'neutral'}>
              {aiStatus?.imageConfigured ? 'ready' : 'not set'}
            </Badge>
          </div>
          <p className="mb-2 text-[11px] leading-relaxed text-mirai-dim">
            Any endpoint speaking <code>POST /images/generations</code> (b64 response) — NVIDIA
            hosted diffusion models, local bridges, any compatible service you own. Generation
            bakes in your Style Bible + shot camera for studio consistency.
          </p>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder={cred('image')?.configured ? 'Replace image provider key…' : 'API key'}
              value={imageKey}
              onChange={(e) => setImageKey(e.target.value)}
            />
            <Button
              variant="primary"
              className="shrink-0"
              loading={setCredential.isPending}
              onClick={() => saveKey('image', imageKey, () => setImageKey(''))}
            >
              Save
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-[1fr_170px_110px_auto] gap-2">
            <div>
              <Label htmlFor="pv-imgbase">Base URL</Label>
              <Input
                id="pv-imgbase"
                className="h-8 text-xs"
                placeholder="https://…/v1"
                value={imageBaseUrl}
                onChange={(e) => setImageBaseUrl(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pv-imgmodel">Model</Label>
              <Input
                id="pv-imgmodel"
                className="h-8 text-xs"
                placeholder="sd3.5 / flux / …"
                value={imageModel}
                onChange={(e) => setImageModel(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pv-imgsize">Size</Label>
              <Select
                id="pv-imgsize"
                className="h-8 text-xs"
                value={imageSize}
                onChange={(e) => setImageSize(e.target.value)}
              >
                <option value="1344x768">1344×768</option>
                <option value="1024x1024">1024×1024</option>
                <option value="768x1344">768×1344</option>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                size="sm"
                variant="primary"
                loading={updateSettings.isPending}
                disabled={!imageBaseUrl.trim() || !imageModel.trim()}
                onClick={() =>
                  saveProviderPrefs({
                    image: {
                      baseUrl: imageBaseUrl.trim(),
                      model: imageModel.trim(),
                      size: imageSize,
                    },
                  })
                }
              >
                Save
              </Button>
            </div>
          </div>
          <p className="mt-1.5 text-[10px] text-mirai-faint">
            All three fields (key, URL, model) enable the “Generate (AI)” button on storyboard shots.
          </p>
        </div>
      </div>
    </Card>
  )
}

function ShortcutsCard() {
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const [capturing, setCapturing] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const effective = effectiveShortcuts(settings?.shortcuts ?? {})
  const groups = ['Timeline', 'Application'] as const

  const saveOverride = (actionId: string, combo: string | null) => {
    if (!settings) return
    const overrides: Record<string, string> = { ...settings.shortcuts }
    if (combo === null || combo === DEFAULT_SHORTCUTS[actionId]) delete overrides[actionId]
    else overrides[actionId] = combo
    void updateSettings.mutateAsync({ ...settings, shortcuts: overrides })
  }

  const onCaptureKey = (e: KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setCapturing(null)
      return
    }
    const combo = comboFromEvent(e)
    if (!isValidCombo(combo)) return
    if (capturing) saveOverride(capturing, combo)
    setCapturing(null)
  }

  useEffect(() => {
    if (!capturing) return
    window.addEventListener('keydown', onCaptureKey, true)
    return () => window.removeEventListener('keydown', onCaptureKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, settings])

  const visible = SHORTCUT_ACTIONS.filter((a) =>
    a.label.toLowerCase().includes(search.trim().toLowerCase()),
  )

  return (
    <Card className="p-5">
      <SectionTitle right={<span className="text-[10px] text-mirai-faint">Click Rebind, then press keys — Esc cancels</span>}>
        Keyboard shortcuts
      </SectionTitle>
      <div className="relative mb-3 w-64">
        <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-mirai-faint" />
        <Input
          className="h-8 pl-8 text-xs"
          placeholder="Search actions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="space-y-4">
        {groups.map((group) => {
          const actions = visible.filter((a) => a.group === group)
          if (actions.length === 0) return null
          return (
            <div key={group}>
              <p className="mb-1 text-[10px] font-bold tracking-[0.16em] text-mirai-faint uppercase">
                {group}
              </p>
              <div className="space-y-1.5">
                {actions.map((action) => {
                  const combo = effective[action.id] ?? action.defaultCombo
                  const isDefault = combo === action.defaultCombo
                  const conflicts = actionsBoundTo(combo, effective).filter((id) => id !== action.id)
                  return (
                    <div key={action.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-mirai-dim">{action.label}</span>
                      <span className="flex items-center gap-2">
                        {conflicts.length > 0 && (
                          <span className="text-[10px] text-amber-400" title={`Also bound to: ${conflicts.length} other action(s)`}>
                            ⚠ conflict
                          </span>
                        )}
                        {capturing === action.id ? (
                          <span className="flex h-7 items-center rounded-md border border-mirai-pink bg-mirai-pink/10 px-2 text-[11px] text-mirai-pink">
                            Press keys…
                          </span>
                        ) : (
                          <span className={cn('flex gap-1', !isDefault && 'text-mirai-pink')}>
                            {prettyCombo(combo).split('+').map((part, i) => (
                              <Kbd key={i}>{part}</Kbd>
                            ))}
                          </span>
                        )}
                        <button
                          className="text-[10px] font-semibold text-mirai-faint transition-colors hover:text-mirai-text"
                          onClick={() => setCapturing(action.id)}
                        >
                          Rebind
                        </button>
                        {!isDefault && (
                          <button
                            className="text-[10px] font-semibold text-mirai-faint transition-colors hover:text-mirai-pink"
                            onClick={() => saveOverride(action.id, null)}
                          >
                            Reset
                          </button>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
