/**
 * TtsVoiceCard — who speaks your anime (v2.1).
 *
 * THREE real providers, no pretense:
 *   · EDGE (recommended, the default): Microsoft's online NEURAL voices —
 *     keyless and clock-authenticated, so there is nothing to expire; 300+
 *     voices across locales, so each character can have their OWN voice.
 *     This is what "Edge TTS nunca pode morrer" means in the interface: it
 *     is the default, needs no account, and the picker shows the REAL
 *     catalog or the REAL reason it could not be read.
 *   · OPENAI-COMPATIBLE: your own key/endpoint (ElevenLabs-style quality,
 *     the paid tier).
 *   · GOOGLE TRANSLATE: the legacy keyless fallback (one voice per locale).
 *
 * The voice id is stored per character (Characters → voice); this card only
 * configures the ENGINE and the default voice.
 */
import { useMemo, useState } from 'react'
import { AudioLines, RefreshCw, Sparkles } from 'lucide-react'
import { useSettings, useUpdateSettings, useEdgeVoices } from '../../lib/queries'
import { useT } from '../../lib/i18n'
import { Badge, Button, Card, Input, Label, SectionTitle, Select } from '../../system/ui'
import { toast } from '../../store/appStore'

type TtsProtocol = 'edge' | 'openai' | 'google-translate'

export function TtsVoiceCard() {
  const tr = useT()
  const { data: settings } = useSettings()
  const update = useUpdateSettings()
  const protocol: TtsProtocol = settings?.ai.tts?.protocol ?? 'edge'
  const [locale, setLocale] = useState<string>('')

  const voices = useEdgeVoices(locale || undefined)
  const tts = settings?.ai.tts
  const [voiceInput, setVoiceInput] = useState(tts?.voice ?? '')

  const edgeVoices = voices.data?.voices ?? []
  const grouped = useMemo(() => {
    const map = new Map<string, typeof edgeVoices>()
    for (const voice of edgeVoices) {
      const list = map.get(voice.locale) ?? []
      list.push(voice)
      map.set(voice.locale, list)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [edgeVoices])

  const locales = useMemo(() => {
    const set = new Set<string>()
    for (const voice of edgeVoices) set.add(voice.locale.split('-')[0] ?? voice.locale)
    return [...set].sort()
  }, [edgeVoices])

  const setProtocol = (next: TtsProtocol) => {
    update.mutate(
      { ai: { ...settings!.ai, tts: { ...settings!.ai.tts, protocol: next } } },
      {
        onSuccess: () => toast({ kind: 'success', title: tr('Voice provider updated') }),
        onError: (err: Error) => toast({ kind: 'error', title: tr('Save failed'), description: err.message }),
      },
    )
  }

  return (
    <Card className="p-5">
      <SectionTitle
        right={
          protocol === 'edge' ? (
            <Badge tone="success">
              <Sparkles className="h-3 w-3" /> {tr('keyless · neural · 24/7')}
            </Badge>
          ) : (
            <Badge>{tr('needs configuration')}</Badge>
          )
        }
      >
        <span className="flex items-center gap-1.5">
          <AudioLines className="h-3.5 w-3.5 text-mirai-accent-2" />
          {tr('Voice acting — who speaks')}
        </span>
      </SectionTitle>

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            { id: 'edge', label: 'Edge neural (recommended)' },
            { id: 'openai', label: 'OpenAI-compatible (your key)' },
            { id: 'google-translate', label: 'Google Translate (basic)' },
          ] as const
        ).map((option) => (
          <button
            key={option.id}
            onClick={() => setProtocol(option.id)}
            className={
              protocol === option.id
                ? 'motion-press rounded-lg border border-mirai-accent/40 bg-mirai-accent/10 p-3 text-left text-xs font-semibold text-mirai-text'
                : 'motion-press rounded-lg border border-mirai-border bg-mirai-panel p-3 text-left text-xs text-mirai-dim hover:border-mirai-border-strong'
            }
          >
            {tr(option.label)}
          </button>
        ))}
      </div>

      {protocol === 'edge' && (
        <div className="mt-4 space-y-3">
          <p className="text-[11px] leading-relaxed text-mirai-dim">
            {tr('Microsoft’s online neural voices — no account, no key, no expiry. The app authenticates with a clock-derived token, so there is nothing to refresh. Each character can carry their own voice id.')}
          </p>
          <div className="flex items-end gap-2">
            <div className="w-40">
              <Label className="text-[10px]">{tr('Language filter')}</Label>
              <Select className="h-8 text-xs" value={locale} onChange={(e) => setLocale(e.target.value)}>
                <option value="">{tr('All languages')}</option>
                {locales.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex-1">
              <Label className="text-[10px]">{tr('Default voice')}</Label>
              <Select
                className="h-8 text-xs"
                value={tts?.voice ?? ''}
                onChange={(e) => {
                  update.mutate(
                    { ai: { ...settings!.ai, tts: { ...settings!.ai.tts, voice: e.target.value } } },
                    {
                      onSuccess: () => toast({ kind: 'success', title: tr('Default voice saved') }),
                      onError: (err: Error) =>
                        toast({ kind: 'error', title: tr('Save failed'), description: err.message }),
                    },
                  )
                }}
              >
                <option value="">{tr('— auto (by interface language) —')}</option>
                {grouped.map(([localeName, list]) => (
                  <optgroup key={localeName} label={localeName}>
                    {list.map((voice) => (
                      <option key={voice.shortName} value={voice.shortName}>
                        {voice.name} · {voice.gender}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </div>
            <Button
              size="sm"
              variant="outline"
              loading={voices.isFetching}
              onClick={() => void voices.refetch()}
            >
              <RefreshCw className="h-3 w-3" /> {tr('Refresh')}
            </Button>
          </div>
          {voices.data && !voices.data.ok && (
            <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
              {tr('The Edge voice catalog could not be read: ')}
              {voices.data.message}
            </p>
          )}
          <p className="text-[10px] text-mirai-faint">
            {tr('The voice id on each character accepts any name from this catalog (Characters → voice section).')}
          </p>
        </div>
      )}

      {protocol === 'openai' && (
        <p className="mt-3 text-[11px] leading-relaxed text-mirai-dim">
          {tr('Configure the endpoint, model and key below — every OpenAI-audio-compatible service works (incl. ElevenLabs proxies). Without a key the app falls back to Edge automatically, so the voice never goes silent.')}
        </p>
      )}

      {protocol === 'google-translate' && (
        <div className="mt-3">
          <Label className="text-[10px]">{tr('Locale / voice')}</Label>
          <Input
            className="h-8 w-48 text-xs"
            value={voiceInput}
            onChange={(e) => setVoiceInput(e.target.value)}
            onBlur={() =>
              update.mutate({
                ai: { ...settings!.ai, tts: { ...settings!.ai.tts, voice: voiceInput.trim() || undefined } },
              })
            }
            placeholder="pt-BR"
          />
          <p className="mt-1 text-[10px] text-mirai-faint">
            {tr('One voice per language — enough to tell speakers apart, not to give each character their own voice.')}
          </p>
        </div>
      )}
    </Card>
  )
}