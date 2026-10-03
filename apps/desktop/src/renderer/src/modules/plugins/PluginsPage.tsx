/**
 * PluginsPage (Phase 9) — the extensibility hub: installed plugins with
 * permissions + capabilities, folder install, command execution, the
 * Provider SDK (apply declared providers into Settings — user stays in
 * control) and the curated marketplace foundation.
 */
import { useState } from 'react'
import {
  CURATED_MARKETPLACE,
  PERMISSION_LABEL,
  type PluginRecord,
} from '@mirai/shared'
import {
  Blocks,
  CheckCircle2,
  Download,
  ExternalLink,
  Package,
  Play,
  Puzzle,
  Store,
  Trash2,
} from 'lucide-react'
import {
  useApplyPluginProvider,
  usePluginMutations,
  usePlugins,
} from '../../lib/queries'
import { toast } from '../../store/appStore'
import { Badge, Button, Spinner } from '../../system/ui'
import { ConfirmModal } from '../../system/Modal'
import { EmptyState } from '../../system/EmptyState'

export function PluginsPage() {
  const { data: plugins, isLoading } = usePlugins()
  const mutations = usePluginMutations()
  const applyProvider = useApplyPluginProvider()
  const [confirmDelete, setConfirmDelete] = useState<PluginRecord | null>(null)
  const [tab, setTab] = useState<'installed' | 'marketplace'>('installed')

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-mirai-text">Plugins</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mirai-dim">
            Local-first extensions: commands, prompt packs, export presets and provider
            adapters (Provider SDK). Every capability is gated by the permissions the
            manifest declares — nothing runs without your say-so.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setTab(tab === 'installed' ? 'marketplace' : 'installed')}
          >
            <Store className="h-3.5 w-3.5" /> {tab === 'installed' ? 'Marketplace' : 'Installed'}
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={mutations.installFromFolder.isPending}
            onClick={() =>
              mutations.installFromFolder.mutate(undefined, {
                onSuccess: (plugin) =>
                  toast({
                    kind: 'success',
                    title: `Installed ${plugin.manifest.name}`,
                    description: 'Enable it below to activate its capabilities.',
                  }),
                onError: (err) => {
                  if (err.message.includes('cancelled')) return
                  toast({ kind: 'error', title: 'Install failed', description: err.message })
                },
              })
            }
          >
            <Download className="h-3.5 w-3.5" /> Install from folder…
          </Button>
        </div>
      </div>

      {tab === 'marketplace' ? (
        <MarketplaceSection />
      ) : isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (plugins ?? []).length === 0 ? (
        <div className="panel border-dashed">
          <EmptyState
            icon={<Puzzle className="h-5 w-5" />}
            title="No plugins installed"
            description="Install a folder containing manifest.json (+ index.js) — see docs/plugins in the repository."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {(plugins ?? []).map((plugin) => (
            <div key={plugin.manifest.id} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-bold text-mirai-text">
                    <Package className="h-4 w-4 text-mirai-pink" />
                    {plugin.manifest.name}
                    <span className="font-mono text-[10px] font-normal text-mirai-faint">v{plugin.manifest.version}</span>
                    {plugin.enabled && <Badge tone="accent">enabled</Badge>}
                  </p>
                  <p className="mt-0.5 text-[11px] text-mirai-dim">
                    {plugin.manifest.description ?? plugin.manifest.id} — by {plugin.manifest.author}
                  </p>
                  {plugin.errors.length > 0 && (
                    <div className="mt-2 rounded-md border border-red-400/30 bg-red-400/5 p-2">
                      <p className="text-[11px] font-semibold text-red-300">Invalid manifest — locked</p>
                      {plugin.errors.map((err, i) => (
                        <p key={i} className="text-[10px] text-red-300/80">{err}</p>
                      ))}
                    </div>
                  )}
                  {/* permissions */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {plugin.manifest.permissions.map((p) => (
                      <span
                        key={p}
                        className="rounded-full border border-mirai-line bg-mirai-panel px-2 py-0.5 text-[9px] font-bold tracking-wide text-mirai-dim uppercase"
                        title={PERMISSION_LABEL[p]}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-none gap-2">
                  <Button
                    size="sm"
                    variant={plugin.enabled ? 'outline' : 'primary'}
                    loading={mutations.setEnabled.isPending && mutations.setEnabled.variables?.id === plugin.manifest.id}
                    onClick={() =>
                      mutations.setEnabled.mutate(
                        { id: plugin.manifest.id, enabled: !plugin.enabled },
                        {
                          onSuccess: (p) =>
                            toast({ kind: 'success', title: `${p.manifest.name} ${p.enabled ? 'enabled' : 'disabled'}` }),
                          onError: (err) => toast({ kind: 'error', title: 'Failed', description: err.message }),
                        },
                      )
                    }
                  >
                    {plugin.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(plugin)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* commands */}
              {plugin.manifest.commands.length > 0 && (
                <div className="mt-3 border-t border-mirai-line pt-2">
                  <p className="mb-1.5 text-[9px] font-bold tracking-[0.14em] text-mirai-faint uppercase">Commands</p>
                  <div className="flex flex-wrap gap-1.5">
                    {plugin.manifest.commands.map((cmd) => (
                      <Button
                        key={cmd.id}
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={!plugin.enabled}
                        title={cmd.description}
                        onClick={() =>
                          mutations.runCommand.mutate(
                            { pluginId: plugin.manifest.id, commandId: cmd.id },
                            {
                              onSuccess: (result) => {
                                const message =
                                  result && typeof result === 'object' && 'message' in result
                                    ? String((result as { message: unknown }).message)
                                    : `${cmd.label} completed.`
                                toast({ kind: 'success', title: cmd.label, description: message })
                              },
                              onError: (err) =>
                                toast({ kind: 'error', title: cmd.label, description: err.message }),
                            },
                          )
                        }
                      >
                        <Play className="h-3 w-3" /> {cmd.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Provider SDK */}
              {plugin.manifest.providers.length > 0 && (
                <div className="mt-3 border-t border-mirai-line pt-2">
                  <p className="mb-1.5 text-[9px] font-bold tracking-[0.14em] text-mirai-faint uppercase">
                    Providers (Provider SDK)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {plugin.manifest.providers.map((provider) => (
                      <span
                        key={provider.id}
                        className="flex items-center gap-2 rounded-md border border-mirai-violet/30 bg-mirai-violet/5 px-2.5 py-1.5 text-[10px] text-mirai-dim"
                      >
                        <span>
                          <span className="font-bold text-mirai-violet">{provider.label}</span>
                          <span className="mx-1">·</span>
                          {provider.kind} · {provider.model}
                        </span>
                        <button
                          className="font-bold text-mirai-pink underline decoration-dotted"
                          title={`Apply this ${provider.kind} provider into Settings (baseUrl + model) — the key stays yours to set`}
                          onClick={() =>
                            applyProvider.mutate(
                              { provider },
                              {
                                onSuccess: (kind) =>
                                  toast({
                                    kind: 'success',
                                    title: `${provider.label} applied as the ${kind} provider`,
                                    description: 'Set its API key in Settings → Providers if needed.',
                                  }),
                                onError: (err) => toast({ kind: 'error', title: 'Apply failed', description: err.message }),
                              },
                            )
                          }
                        >
                          Apply
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* contributions summary */}
              {(plugin.manifest.prompts.length > 0 || plugin.manifest.exportPresets.length > 0) && (
                <p className="mt-2 text-[10px] text-mirai-faint">
                  Contributes {plugin.manifest.prompts.length} prompt(s) to the Prompt Library and{' '}
                  {plugin.manifest.exportPresets.length} export preset(s) to the Export Center
                  {plugin.enabled ? '' : ' — enable to activate'}.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) {
            mutations.remove.mutate(confirmDelete.manifest.id, {
              onSuccess: () => toast({ kind: 'success', title: 'Plugin removed' }),
              onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }),
            })
          }
          setConfirmDelete(null)
        }}
        title={`Delete "${confirmDelete?.manifest.name ?? ''}"?`}
        description="The plugin folder is removed from the app's plugins directory. Projects are never touched."
        confirmLabel="Delete plugin"
        danger
      />
    </div>
  )
}

function MarketplaceSection() {
  return (
    <div className="space-y-3">
      <div className="panel flex items-center gap-3 border-mirai-violet/20 bg-mirai-violet/5 p-4">
        <Blocks className="h-5 w-5 flex-none text-mirai-violet" />
        <p className="text-[11px] leading-relaxed text-mirai-dim">
          The marketplace is a curated registry of plugin specs — a foundation, not a store:
          entries list where the plugin lives and how to install it locally.
          Publish your own by hosting a folder with a manifest and opening a PR to this list.
        </p>
      </div>
      {CURATED_MARKETPLACE.map((entry) => (
        <div key={entry.id} className="panel flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-bold text-mirai-text">{entry.name}</p>
            <p className="mt-0.5 text-[11px] text-mirai-dim">{entry.description}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[10px] text-mirai-faint">
              <ExternalLink className="h-3 w-3" /> {entry.source}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {entry.permissions.map((p) => (
                <span
                  key={p}
                  className="rounded-full border border-mirai-line bg-mirai-panel px-1.5 py-0.5 text-[8px] font-bold tracking-wide text-mirai-faint uppercase"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
          {entry.installHint && (
            <p className="hidden max-w-56 shrink-0 text-right text-[10px] leading-relaxed text-mirai-faint md:block">
              <CheckCircle2 className="mb-1 ml-auto h-3 w-3 text-emerald-400" />
              {entry.installHint}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
