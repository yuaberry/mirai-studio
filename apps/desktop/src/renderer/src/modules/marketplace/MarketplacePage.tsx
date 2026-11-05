/**
 * MarketplacePage — the AI Marketplace.
 *
 * TWO TABS, TWO REAL SOURCES OF TRUTH:
 *   1. Providers — curated cards (shared contracts). Every card names a
 *      protocol the app IMPLEMENTS; there is no entry the app cannot
 *      drive, and no button that pretends to work.
 *   2. Models — the LIVE catalog read from the vendors' own endpoints
 *      (Pollinations publishes its media catalog; the chat list comes from
 *      the configured provider). Nothing is hardcoded here.
 *
 * Applying a card WRITES THE REAL SETTINGS (protocol, base URL, model) and
 * the key goes to the encrypted credential vault — nothing is simulated.
 */
import { useMemo, useState } from 'react'
import {
  AudioLines,
  Check,
  ExternalLink,
  Film,
  Image as ImageIcon,
  KeyRound,
  MessageSquare,
  RefreshCw,
  Search,
  Store,
  Zap,
} from 'lucide-react'
import type {
  AiCapability,
  CredentialKey,
  MarketplaceModel,
  MarketplaceProvider,
} from '@mirai/shared'
import {
  useApplyMarketplaceProvider,
  useMarketplaceCatalog,
  useSetCredential,
} from '../../lib/queries'
import { toast } from '../../store/appStore'
import { useT } from '../../lib/i18n'
import { Badge, Button, Card, Input, Spinner } from '../../system/ui'
import { EmptyState, ErrorState } from '../../system/EmptyState'

const CAPABILITY_LABEL: Record<AiCapability, string> = {
  chat: 'Script & dialogue',
  image: 'Frames & art',
  video: 'Video',
  tts: 'Voice acting',
}

const CAPABILITY_ICON: Record<AiCapability, typeof MessageSquare> = {
  chat: MessageSquare,
  image: ImageIcon,
  video: Film,
  tts: AudioLines,
}

const CREDENTIAL_LABEL: Record<CredentialKey, string> = {
  openrouter: 'OpenRouter',
  nvidia: 'NVIDIA NIM',
  image: 'Image provider',
  videogen: 'Video provider',
  tts: 'Voice provider',
}

type Filter = 'all' | AiCapability

export function MarketplacePage() {
  const tr = useT()
  const { data, isLoading, isError, error, refetch, isFetching } = useMarketplaceCatalog()
  const apply = useApplyMarketplaceProvider()
  const [tab, setTab] = useState<'providers' | 'models'>('providers')
  const [capability, setCapability] = useState<Filter>('all')
  const [freeOnly, setFreeOnly] = useState(false)
  const [search, setSearch] = useState('')

  const providers = data?.providers ?? []
  const models = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (data?.models ?? []).filter((m) => {
      if (capability !== 'all' && m.capability !== capability) return false
      if (freeOnly && !m.free) return false
      if (!term) return true
      return m.id.toLowerCase().includes(term) || m.name.toLowerCase().includes(term)
    })
  }, [data?.models, capability, freeOnly, search])

  const applyProvider = (provider: MarketplaceProvider) => {
    apply.mutate(
      { providerId: provider.id },
      {
        onSuccess: (result) => {
          toast({
            kind: result.requiresKey ? 'info' : 'success',
            title: `${provider.name} selected`,
            description: result.message,
          })
        },
        onError: (err) =>
          toast({ kind: 'error', title: `Couldn't apply ${provider.name}`, description: err.message }),
      },
    )
  }

  const applyModel = (model: MarketplaceModel) => {
    apply.mutate(
      { providerId: model.providerId, model: model.id },
      {
        onSuccess: (result) => {
          toast({
            kind: result.requiresKey ? 'info' : 'success',
            title: `Model applied: ${model.id}`,
            description: result.message,
          })
        },
        onError: (err) =>
          toast({ kind: 'error', title: `Couldn't apply ${model.id}`, description: err.message }),
      },
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display flex items-center gap-2 text-xl font-bold text-mirai-text">
            <Store className="h-5 w-5 text-mirai-accent" /> AI Marketplace
          </h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-mirai-dim">
            Providers and models the studio can ACTUALLY drive — every card below is backed
            by a real adapter, and the model list is read live from the vendors. Generation
            runs in the vendor's cloud; nothing is processed on this machine.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          loading={isFetching}
          onClick={() => void refetch()}
          title="Read the vendors' catalogs again"
        >
          <RefreshCw className="h-3.5 w-3.5" /> {tr('Refresh')}
        </Button>
      </div>

      <div className="mb-4 flex items-center gap-1 border-b border-mirai-border">
        {(
          [
            { id: 'providers' as const, label: tr('Providers'), count: providers.length },
            { id: 'models' as const, label: tr('Live models'), count: data?.models.length ?? 0 },
          ]
        ).map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={
              tab === item.id
                ? 'relative -mb-px border-b-2 border-mirai-accent px-3 py-2 text-xs font-semibold text-mirai-text'
                : 'relative -mb-px border-b-2 border-transparent px-3 py-2 text-xs font-semibold text-mirai-dim hover:text-mirai-text'
            }
          >
            {item.label}
            {item.count > 0 && (
              <span className="ml-1.5 rounded-full bg-mirai-hover px-1.5 text-[10px] text-mirai-dim">
                {item.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {isError ? (
        <ErrorState
          title="Couldn't load the catalog"
          message={(error as Error).message}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : tab === 'providers' ? (
        <div className="grid gap-3 md:grid-cols-2">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              ready={data?.configured.includes(provider.id) ?? false}
              busy={apply.isPending && apply.variables?.providerId === provider.id}
              onApply={() => applyProvider(provider)}
              tr={tr}
            />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-mirai-faint" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tr('Search models…')}
                className="h-8 w-64 pl-7 text-xs"
              />
            </div>
            <select
              value={capability}
              onChange={(e) => setCapability(e.target.value as Filter)}
              className="h-8 rounded-md border border-mirai-border-strong bg-mirai-raise px-2 text-xs text-mirai-text"
            >
              <option value="all">{tr('All capabilities')}</option>
              <option value="chat">{tr('Script & dialogue')}</option>
              <option value="image">{tr('Frames & art')}</option>
              <option value="video">{tr('Video')}</option>
              <option value="tts">{tr('Voice acting')}</option>
            </select>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-mirai-dim">
              <input
                type="checkbox"
                checked={freeOnly}
                onChange={(e) => setFreeOnly(e.target.checked)}
                className="accent-mirai-accent"
              />
              {tr('Free only')}
            </label>
            {data && data.degraded.length > 0 && (
              <span className="text-[10px] text-mirai-warn">
                Unreachable: {data.degraded.join(', ')}
              </span>
            )}
          </div>

          {models.length === 0 ? (
            <div className="panel border-dashed">
              <EmptyState
                icon={<Search className="h-5 w-5" />}
                title="No model matches this filter"
                description="Try another capability or clear the search — the catalogs are read live."
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              {models.map((model) => (
                <div
                  key={`${model.providerId}:${model.id}`}
                  className="panel flex flex-wrap items-center gap-3 px-3 py-2"
                >
                  <span className="text-mirai-faint">
                    {(() => {
                      const Icon = CAPABILITY_ICON[model.capability]
                      return <Icon className="h-3.5 w-3.5" />
                    })()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-mirai-text">{model.id}</p>
                    <p className="truncate text-[10px] text-mirai-faint">
                      {model.name}
                      {model.price ? ` · ${model.price}` : ''}
                      {model.resolutions.length > 0 ? ` · ${model.resolutions.join('/')}` : ''}
                    </p>
                  </div>
                  {model.free ? <Badge tone="success">free</Badge> : <Badge tone="warn">paid</Badge>}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6"
                    loading={apply.isPending && apply.variables?.model === model.id}
                    onClick={() => applyModel(model)}
                  >
                    {tr('Use model')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ProviderCard({
  provider,
  ready,
  busy,
  onApply,
  tr,
}: {
  provider: MarketplaceProvider
  ready: boolean
  busy: boolean
  onApply: () => void
  tr: (key: string) => string
}) {
  const setCredential = useSetCredential()
  const [key, setKey] = useState('')
  const Icon = CAPABILITY_ICON[provider.capability]
  // Narrowed once: TS cannot keep the optionality out of the closures.
  const credentialKey = provider.credentialKey

  const saveKey = () => {
    if (!key.trim() || !credentialKey) return
    setCredential.mutate(
      { key: credentialKey, value: key.trim() },
      {
        onSuccess: () => {
          setKey('')
          toast({
            kind: 'success',
            title: 'API key stored',
            description: `${CREDENTIAL_LABEL[credentialKey]} key saved in the encrypted vault.`,
          })
        },
        onError: (err) =>
          toast({ kind: 'error', title: "Couldn't store the key", description: err.message }),
      },
    )
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold text-mirai-text">
            <Icon className="h-4 w-4 text-mirai-accent-2" />
            {provider.name}
          </p>
          <p className="mt-0.5 text-[10px] font-semibold tracking-wide text-mirai-faint uppercase">
            {tr(CAPABILITY_LABEL[provider.capability])} · {provider.protocol}
          </p>
        </div>
        {ready ? (
          <Badge tone="success">
            <Check className="h-3 w-3" /> {tr('ready')}
          </Badge>
        ) : provider.requiresKey ? (
          <Badge tone="warn">{tr('needs key')}</Badge>
        ) : (
          <Badge tone="success">{tr('no key needed')}</Badge>
        )}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-mirai-dim">{provider.summary}</p>
      {provider.notes && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-mirai-faint">{provider.notes}</p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {provider.freeTier && <Badge tone="info">{tr('free tier')}</Badge>}
        {provider.watermarkFree && <Badge tone="violet">{tr('no watermark')}</Badge>}
        {provider.cloud && (
          <Badge tone="neutral">
            <Zap className="h-3 w-3" /> {tr('cloud')}
          </Badge>
        )}
      </div>

      {provider.requiresKey && credentialKey && (
        <div className="mt-3 border-t border-mirai-line pt-3">
          <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-mirai-faint uppercase">
            <KeyRound className="h-3 w-3" /> {CREDENTIAL_LABEL[credentialKey]} API key
          </label>
          <div className="flex gap-1.5">
            <Input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste the key…"
              className="h-8 flex-1 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveKey()
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={!key.trim()}
              loading={setCredential.isPending}
              onClick={saveKey}
            >
              {tr('Save')}
            </Button>
          </div>
          {provider.signupUrl && (
            <a
              href={provider.signupUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-mirai-accent-3 hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> {tr('Get a key / free credits')}
            </a>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-mirai-line pt-3">
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          onClick={onApply}
          title="Write this provider into the studio settings"
        >
          {tr('Use provider')}
        </Button>
        {provider.docsUrl && (
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-mirai-dim hover:text-mirai-text hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> {tr('Docs')}
          </a>
        )}
      </div>
    </Card>
  )
}
