/**
 * Settings — General, AI (OpenRouter credentials + live model catalog),
 * appearance, shortcuts reference.
 */
import { useEffect, useState } from 'react'
import { EyeOff, KeyRound, RefreshCw, Save } from 'lucide-react'
import { MiraiError, type AppSettings } from '@mirai/shared'
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
        <AICard />
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

function AICard() {
  const { data: credentials, isLoading } = useCredentialsStatus()
  const { data: aiStatus } = useAiStatus()
  const { data: models, isLoading: modelsLoading, isError: modelsError, error: modelsError_, refetch: refetchModels } = useAiModels()
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const setCredential = useSetCredential()
  const clearCredential = useClearCredential()
  const [keyValue, setKeyValue] = useState('')
  const [selectedModel, setSelectedModel] = useState<string>(settings?.ai.defaultModel ?? '')

  // Sync the picker when settings arrive/change externally.
  useEffect(() => {
    if (settings?.ai.defaultModel) {
      setSelectedModel(settings.ai.defaultModel)
    }
  }, [settings?.ai.defaultModel])

  const openrouter = credentials?.find((c) => c.key === 'openrouter')

  const saveModelPrefs = () => {
    if (!settings) return
    updateSettings.mutate(
      { ...settings, ai: { ...settings.ai, defaultModel: selectedModel || undefined } },
      {
        onSuccess: () => toast({ kind: 'success', title: 'AI preferences saved' }),
        onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
      },
    )
  }

  const saveKey = () => {
    if (!keyValue.trim()) {
      toast({ kind: 'warning', title: 'Paste an API key first' })
      return
    }
    setCredential.mutate(
      { key: 'openrouter', value: keyValue.trim() },
      {
        onSuccess: (secure) => {
          setKeyValue('')
          toast({
            kind: secure ? 'success' : 'warning',
            title: 'OpenRouter key stored',
            description: secure
              ? 'Encrypted with your OS keychain.'
              : 'Stored WITHOUT encryption — OS secure storage unavailable.',
          })
        },
        onError: (err) => toast({ kind: 'error', title: 'Failed to store key', description: err.message }),
      },
    )
  }

  return (
    <Card className="p-5">
      <SectionTitle
        right={
          isLoading ? (
            <Spinner className="h-4 w-4" />
          ) : openrouter?.configured ? (
            <Badge tone={openrouter.secure ? 'success' : 'warn'}>
              <KeyRound className="h-3 w-3" />
              {openrouter.secure ? 'Stored encrypted' : 'Stored unencrypted'}
            </Badge>
          ) : (
            <Badge tone="neutral">Not configured</Badge>
          )
        }
      >
        AI — OpenRouter
      </SectionTitle>

      <p className="mb-4 text-xs leading-relaxed text-mirai-dim">
        The key is encrypted with your OS keychain and only used to call OpenRouter directly.
        It is never shown again, never logged, and the renderer only ever sees whether it exists.
        Model discovery uses OpenRouter's public catalog.
      </p>

      <div className="flex gap-2">
        <Input
          type="password"
          placeholder={openrouter?.configured ? 'Replace stored key…' : 'sk-or-v1-…'}
          value={keyValue}
          onChange={(e) => setKeyValue(e.target.value)}
        />
        <Button variant="primary" className="shrink-0" loading={setCredential.isPending} onClick={saveKey}>
          {openrouter?.configured ? 'Replace' : 'Save Key'}
        </Button>
        {openrouter?.configured && (
          <Button
            variant="outline"
            className="shrink-0"
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
      <p className="mt-2 flex items-center gap-1.5 text-[10px] text-mirai-faint">
        <EyeOff className="h-3 w-3" /> Values are write-only — this field is emptied after saving.
      </p>

      {/* ------------------------------------------------ default model picker */}
      <div className="mt-6 border-t border-mirai-border pt-4">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-mirai-text">Default model</p>
            <p className="text-[11px] text-mirai-dim">
              Used by AI Assist. Free models are marked — they can disappear anytime (spec §38).
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            loading={modelsLoading}
            onClick={() => void refetchModels()}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh catalog
          </Button>
        </div>

        {modelsError ? (
          <p className="rounded-md border border-mirai-warn/25 bg-mirai-warn/10 px-3 py-2 text-[11px] text-mirai-warn">
            Couldn't reach the model catalog ({modelsError_ instanceof Error ? modelsError_.message : 'network error'}).
            Check your connection and refresh — chat still works with a previously chosen model.
          </p>
        ) : (
          <Select
            className="h-8 text-xs"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={modelsLoading}
          >
            <option value="">
              {modelsLoading ? 'Loading catalog…' : '— choose a model —'}
            </option>
            {(models?.models ?? [])
              .slice()
              .sort((a, b) => Number(b.isFree) - Number(a.isFree) || a.id.localeCompare(b.id))
              .map((model) => (
                <option key={model.id} value={model.id}>
                  {model.isFree ? 'FREE · ' : ''}
                  {model.id}
                  {model.contextLength ? ` · ${Math.round(model.contextLength / 1000)}k ctx` : ''}
                </option>
              ))}
          </Select>
        )}

        <div className="mt-3 flex items-center justify-between">
          {aiStatus?.defaultModel ? (
            <span className="text-[11px] text-mirai-faint">
              Current: <span className="text-mirai-dim">{aiStatus.defaultModel}</span>
            </span>
          ) : (
            <span className="text-[11px] text-mirai-warn">No model selected yet — AI Assist needs one.</span>
          )}
          <Button
            size="sm"
            variant="primary"
            disabled={!selectedModel}
            loading={updateSettings.isPending}
            onClick={saveModelPrefs}
          >
            Save Model
          </Button>
        </div>
        {models && (
          <p className="mt-1 text-[10px] text-mirai-faint">
            {models.models.length} models discovered · {models.cached ? 'from cache' : 'live'} ·{' '}
            {models.models.filter((m) => m.isFree).length} free
          </p>
        )}
      </div>
    </Card>
  )
}

function ShortcutsCard() {
  const rows: Array<[string, string]> = [
    ['Ctrl / ⌘ + K', 'Command palette'],
    ['Ctrl / ⌘ + ,', 'Open settings'],
    ['Ctrl + Enter', 'Send message in AI Assist'],
    ['Esc', 'Close dialogs and palette'],
  ]
  return (
    <Card className="p-5">
      <SectionTitle right={<span className="text-[10px] text-mirai-faint">Custom shortcuts arrive with Phase 5 editors</span>}>
        Keyboard shortcuts
      </SectionTitle>
      <div className="space-y-2">
        {rows.map(([keys, action]) => (
          <div key={keys} className="flex items-center justify-between text-xs text-mirai-dim">
            <span>{action}</span>
            <span className="flex gap-1">
              {keys.split('+').map((k) => (
                <Kbd key={k}>{k.trim()}</Kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
