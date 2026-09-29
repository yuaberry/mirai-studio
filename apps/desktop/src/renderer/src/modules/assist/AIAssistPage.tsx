/**
 * AI Assist (Phase 2) — a streaming chat that KNOWS the project:
 * only the consented context (Story Bible / Cast / current Scene) is sent
 * to OpenRouter, with an explicit privacy notice (spec §15).
 * Prompts from the Prompt Library can be seeded into the input.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Send, Settings as SettingsIcon, Square, WifiOff } from 'lucide-react'
import { type ChatMessage } from '@mirai/shared'
import { Badge, Button, Select } from '../../system/ui'
import { EmptyState } from '../../system/EmptyState'
import { invoke, onEvent } from '../../lib/ipc'
import { useAiStatus, useCurrentProject, useEpisodes, useScenes, useCharacters } from '../../lib/queries'
import { useAppStore } from '../../store/appStore'
import { MiniMarkdown } from './MiniMarkdown'

interface UIMessage extends ChatMessage {
  id: string
  streaming?: boolean
  error?: string
}

export function AIAssistPage() {
  const { data: ai } = useAiStatus()
  const { data: project } = useCurrentProject()
  const { data: episodes } = useEpisodes()
  const { data: characters } = useCharacters()
  const assistSeed = useAppStore((s) => s.assistSeed)
  const setAssistSeed = useAppStore((s) => s.setAssistSeed)
  const setView = useAppStore((s) => s.setView)

  const [messages, setMessages] = useState<UIMessage[]>([])
  const [input, setInput] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  const streaming = requestId !== null

  const [includeBible, setIncludeBible] = useState(false)
  const [includeCharacters, setIncludeCharacters] = useState(false)
  const [sceneId, setSceneId] = useState('')
  const [episodeId, setEpisodeId] = useState('')
  const { data: scenes } = useScenes(episodeId || undefined)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Prompt Library seeding.
  useEffect(() => {
    if (assistSeed) {
      setInput((current) => (current.trim() ? `${assistSeed}\n\n---\n\n${current}` : assistSeed))
      setAssistSeed(null)
      inputRef.current?.focus()
    }
  }, [assistSeed, setAssistSeed])

  // Streaming events. The assistant bubble is keyed `a-<requestId>`.
  useEffect(() => {
    const offChunk = onEvent('ai:chunk', ({ requestId: rid, delta }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === `a-${rid}` ? { ...m, content: m.content + delta } : m)),
      )
    })
    const offDone = onEvent('ai:done', ({ requestId: rid }) => {
      setMessages((prev) => prev.map((m) => (m.id === `a-${rid}` ? { ...m, streaming: false } : m)))
      setRequestId((current) => (current === rid ? null : current))
    })
    const offError = onEvent('ai:error', ({ requestId: rid, error }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === `a-${rid}`
            ? { ...m, streaming: false, error: `${error.code}: ${error.message}` }
            : m,
        ),
      )
      setRequestId((current) => (current === rid ? null : current))
    })
    return () => {
      offChunk()
      offDone()
      offError()
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const online = typeof navigator !== 'undefined' ? navigator.onLine : true
  const canChat = ai?.configured && !!ai.defaultModel && !!project && online

  const send = async () => {
    if (!canChat || streaming || !input.trim()) return
    const content = input.trim()
    const history = messages
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content }))

    setInput('')
    try {
      // Invoke first — it returns instantly with the real requestId, so the
      // streaming placeholder is born with the correct key (no re-key race).
      const result = await invoke('ai:chat', {
        messages: [...history, { role: 'user', content }],
        context: {
          includeBible,
          includeCharacters,
          sceneId: sceneId || undefined,
        },
      })
      setRequestId(result.requestId)
      setMessages((prev) => [
        ...prev,
        { id: result.requestId, role: 'user', content },
        { id: `a-${result.requestId}`, role: 'assistant', content: '', streaming: true },
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: `u-${Math.random().toString(36).slice(2)}`, role: 'user', content },
        {
          id: `e-${Math.random().toString(36).slice(2)}`,
          role: 'assistant',
          content: '',
          streaming: false,
          error: (err as Error).message,
        },
      ])
    }
  }

  const abort = () => {
    if (requestId) void invoke('ai:abort', { requestId })
  }

  const contextNotice = useMemo(() => {
    const parts: string[] = []
    if (includeBible) parts.push('Story Bible')
    if (includeCharacters) parts.push(`Cast (${characters?.length ?? 0})`)
    if (sceneId) parts.push('current scene')
    if (parts.length === 0) return 'No project context will be sent.'
    return `Sent to the provider: ${parts.join(', ')}.`
  }, [includeBible, includeCharacters, sceneId, characters])

  if (!project) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ---------------------------------------------------------- header */}
      <div className="border-b border-mirai-border px-8 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-lg font-bold text-mirai-text">AI Assist</h1>
            <Badge tone="violet">OpenRouter</Badge>
            {ai?.defaultModel && (
              <Badge tone={ai.defaultModel.includes(':free') ? 'success' : 'neutral'}>
                {ai.defaultModel}
              </Badge>
            )}
          </div>
          <ContextToggles
            includeBible={includeBible}
            includeCharacters={includeCharacters}
            sceneEnabled={!!sceneId}
            onToggleBible={() => setIncludeBible((v) => !v)}
            onToggleCast={() => setIncludeCharacters((v) => !v)}
            episodes={episodes ?? []}
            episodeId={episodeId}
            scenes={scenes ?? []}
            sceneId={sceneId}
            onSelectEpisode={setEpisodeId}
            onSelectScene={setSceneId}
          />
        </div>
        <p className="mt-1 text-[11px] text-mirai-faint">
          {contextNotice} Everything else stays on your machine.
        </p>
      </div>

      {/* ---------------------------------------------------------- messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl">
            <EmptyState
              icon={<Sparkle />}
              title="Your canon-aware writing partner"
              description={
                ai?.configured
                  ? 'Ask for premises, dialogue punch-ups, scene beats — enable Story Bible / Cast / Scene context above and it answers inside your canon.'
                  : 'Configure your OpenRouter key to start. The assistant only sees what you explicitly enable.'
              }
              action={
                !ai?.configured ? (
                  <Button variant="primary" size="sm" onClick={() => setView('settings')}>
                    <SettingsIcon className="h-3.5 w-3.5" /> Open Settings → AI
                  </Button>
                ) : !ai.defaultModel ? (
                  <Button variant="primary" size="sm" onClick={() => setView('settings')}>
                    <SettingsIcon className="h-3.5 w-3.5" /> Choose a model first
                  </Button>
                ) : undefined
              }
              className="min-h-64"
            />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- input */}
      <div className="border-t border-mirai-border px-8 py-4">
        <div className="mx-auto max-w-3xl">
          {!online && (
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-mirai-warn">
              <WifiOff className="h-3.5 w-3.5" /> Offline — AI is unavailable until the connection returns.
            </p>
          )}
          <div className="panel focus-within:border-mirai-accent/40 p-2">
            <textarea
              ref={inputRef}
              rows={3}
              data-selectable="true"
              placeholder="Ask for a scene, a dialogue pass, a manga panel prompt… (Ctrl+Enter to send)"
              className="w-full resize-none bg-transparent px-2 py-1 text-sm text-mirai-text placeholder:text-mirai-faint focus:outline-none"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-[10px] text-mirai-faint">
                {streaming ? 'Streaming — press the stop button to cancel' : 'Ctrl+Enter to send'}
              </span>
              {streaming ? (
                <Button size="sm" variant="danger" onClick={abort}>
                  <Square className="h-3 w-3" /> Stop
                </Button>
              ) : (
                <Button size="sm" variant="primary" disabled={!canChat || !input.trim()} onClick={() => void send()}>
                  <Send className="h-3.5 w-3.5" /> Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Sparkle() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="sparkle-g" x1="0" y1="0" x2="24" y2="24">
          <stop offset="0" stopColor="#f472b6" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path
        d="M12 2 14.2 9.8 22 12 14.2 14.2 12 22 9.8 14.2 2 12 9.8 9.8Z"
        fill="url(#sparkle-g)"
      />
    </svg>
  )
}

function ContextToggles({
  includeBible,
  includeCharacters,
  sceneEnabled,
  onToggleBible,
  onToggleCast,
  episodes,
  episodeId,
  scenes,
  sceneId,
  onSelectEpisode,
  onSelectScene,
}: {
  includeBible: boolean
  includeCharacters: boolean
  sceneEnabled: boolean
  onToggleBible: () => void
  onToggleCast: () => void
  episodes: Array<{ id: string; title: string; season: number; number: number }>
  episodeId: string
  scenes: Array<{ id: string; title: string; orderIndex: number }>
  sceneId: string
  onSelectEpisode: (id: string) => void
  onSelectScene: (id: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Toggle active={includeBible} onClick={onToggleBible} label="Story Bible" />
      <Toggle active={includeCharacters} onClick={onToggleCast} label="Cast" />
      <Select
        className="h-7 w-40 text-[11px]"
        value={episodeId}
        onChange={(e) => {
          onSelectEpisode(e.target.value)
          onSelectScene('')
        }}
      >
        <option value="">— episode —</option>
        {episodes.map((episode) => (
          <option key={episode.id} value={episode.id}>
            S{episode.season}E{episode.number} · {episode.title.slice(0, 18)}
          </option>
        ))}
      </Select>
      <Select
        className="h-7 w-44 text-[11px]"
        value={sceneId}
        onChange={(e) => onSelectScene(e.target.value)}
        disabled={!episodeId}
      >
        <option value="">— scene —</option>
        {scenes.map((scene) => (
          <option key={scene.id} value={scene.id}>
            {scene.orderIndex + 1}. {scene.title.slice(0, 24)}
          </option>
        ))}
      </Select>
      {sceneEnabled && <Badge tone="violet">scene context</Badge>}
    </div>
  )
}

function Toggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? 'border-mirai-accent-2/40 bg-mirai-accent-2/15 text-mirai-accent-2'
          : 'border-mirai-border-strong bg-mirai-panel text-mirai-faint hover:text-mirai-dim'
      }`}
    >
      {active ? '● ' : ''}{label}
    </button>
  )
}

function MessageBubble({ message }: { message: UIMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-xl rounded-br-sm border border-mirai-accent/25 bg-mirai-accent/10 px-4 py-2.5">
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-mirai-text" data-selectable="true">
            {message.content}
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-xl rounded-bl-sm border border-mirai-border bg-mirai-panel px-4 py-3">
        {message.error ? (
          <p className="text-xs leading-relaxed text-mirai-danger" data-selectable="true">
            {message.error}
          </p>
        ) : message.content.length === 0 && message.streaming ? (
          <p className="flex items-center gap-2 text-xs text-mirai-dim">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking…
          </p>
        ) : (
          <MiniMarkdown text={message.content} />
        )}
        {message.streaming && message.content.length > 0 && (
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-mirai-accent align-middle" />
        )}
      </div>
    </div>
  )
}
