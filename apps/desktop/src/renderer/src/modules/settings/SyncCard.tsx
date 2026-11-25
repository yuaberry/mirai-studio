/**
 * SyncCard — o celular como controle remoto (v2.1).
 *
 * Uma chave, três campos: o servidor (onde a conta mora), o token da sessão
 * e a opção de LIGAR o agente. Ligado, este computador escuta a fila de
 * operações do servidor e executa o que o celular pede — os dois veem o
 * progresso pelo mesmo canal de eventos. O status é honesto: "agente ativo"
 * só aparece quando o agente está, de fato, rodendo.
 */
import { useState } from 'react'
import { Radio, RefreshCw } from 'lucide-react'
import { MiraiError } from '@mirai/shared'
import { useSettings, useUpdateSettings } from '../../lib/queries'
import { invoke } from '../../lib/ipc'
import { useT } from '../../lib/i18n'
import { Badge, Button, Card, Input, Label, SectionTitle } from '../../system/ui'
import { toast } from '../../store/appStore'

interface SyncStatus {
  configured: boolean
  agentActive: boolean
  lastPollAt: number
  lastError: string | null
  url: string
}

export function SyncCard() {
  const tr = useT()
  const { data: settings } = useSettings()
  const update = useUpdateSettings()
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const collab = settings?.ai.collaboration

  const refreshStatus = async () => {
    try {
      const res = (await invoke('collaboration:status', {})) as SyncStatus
      setStatus(res)
    } catch (err) {
      toast({ kind: 'error', title: tr('Status failed'), description: (err as MiraiError).message })
    }
  }

  return (
    <Card className="p-5">
      <SectionTitle
        right={
          status?.agentActive ? (
            <Badge tone="success">
              <Radio className="h-3 w-3" /> {tr('agente ativo')}
            </Badge>
          ) : (
            <Badge>{tr('agente desligado')}</Badge>
          )
        }
      >
        <span className="flex items-center gap-1.5">
          <Radio className="h-3.5 w-3.5 text-mirai-accent" />
          {tr('Tempo real com o celular')}
        </span>
      </SectionTitle>

      <p className="mb-3 text-[11px] leading-relaxed text-mirai-dim">
        {tr('Ligue o servidor de colaboração com --with-sync, entre com a MESMA conta no celular, e os dois dispositivos veem a mesma coisa. O celular manda as operações; este computador executa.')}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px]">{tr('Servidor')}</Label>
          <Input
            className="h-8 text-xs"
            value={collab?.url ?? ''}
            onChange={(e) =>
              update.mutate({
                ai: { ...settings!.ai, collaboration: { ...settings!.ai.collaboration, url: e.target.value } },
              })
            }
            placeholder="http://127.0.0.1:8787"
          />
        </div>
        <div>
          <Label className="text-[10px]">{tr('Token da sessão')}</Label>
          <Input
            className="h-8 text-xs"
            value={collab?.token ?? ''}
            onChange={(e) =>
              update.mutate({
                ai: { ...settings!.ai, collaboration: { ...settings!.ai.collaboration, token: e.target.value } },
              })
            }
            placeholder="token de /login"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-lg border border-mirai-border bg-mirai-panel px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-mirai-text">{tr('Escutar as operações do celular')}</p>
          <p className="text-[11px] text-mirai-dim">
            {tr('Ligado, este computador executa o que o celular enfileirar (produzir episódio, dublar, camera moves, renderizar).')}
          </p>
        </div>
        <Button
          size="sm"
          variant={collab?.syncEnabled ? 'primary' : 'outline'}
          onClick={() =>
            update.mutate(
              {
                ai: {
                  ...settings!.ai,
                  collaboration: { ...settings!.ai.collaboration, syncEnabled: !collab?.syncEnabled },
                },
              },
              {
                onSuccess: () => toast({ kind: 'success', title: tr('Salvo — reinicie o app para o agente ligar/desligar') }),
                onError: (err) => toast({ kind: 'error', title: tr('Save failed'), description: err.message }),
              },
            )
          }
        >
          {collab?.syncEnabled ? tr('ON') : tr('OFF')}
        </Button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void refreshStatus()}>
          <RefreshCw className="h-3 w-3" /> {tr('Ver status')}
        </Button>
        {status && (
          <span className="text-[10px] text-mirai-faint">
            {status.agentActive
              ? `${tr('Última verificação')}: ${status.lastPollAt ? new Date(status.lastPollAt).toLocaleTimeString() : '—'}`
              : status.configured
                ? tr('Servidor configurado, mas a chave está desligada')
                : tr('Nenhum servidor configurado')}
          </span>
        )}
        {status?.lastError && (
          <span className="text-[10px] text-amber-300">
            {tr('último erro')}: {status.lastError}
          </span>
        )}
      </div>
    </Card>
  )
}