/**
 * Mirai Studio Companion v2.1 — o celular como controle remoto REAL.
 *
 * O USUÁRIO PEDIU: mandar a requisição pelo celular, fazer o que o
 * computador faz, e ver os dois dispositivos em tempo real na MESMA conta.
 *
 * Não é injeção local: o celular fala com o SERVIDOR de colaboração (onde
 * a conta mora), que entrega os eventos pelos dois lados. O celular:
 *   · entran com a mesma conta;
 *   · vê os projetos publicados pelo computador APARECEREM sozinhos (SSE);
 *   · MANDA operações — produzir episódio, dublar, camera moves, render —
 *     que o computador executa com os serviços de verdade;
 *   · acompanha o progresso ao vivo, nos dois dispositivos.
 *
 * E continua lendo dossiês/ arquivos .zip locais (a função original), agora
 * ao lado do canal.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseDossier, type ParsedDossier } from './dossier'
import { readZipTexts } from './zip'
import { motionCss } from './motion'

const APP_VERSION = '2.1.1-companion'

interface ServerProject {
  id: string
  title: string
  tagline?: string
  author?: { displayName?: string }
  medium?: string
  downloads?: number
  totalBytes?: number
  publishedAt?: string
  summary?: string
}

interface LiveOp {
  id: string
  kind: string
  projectId: string
  status: string
  progress: number
  message: string
}

interface Session {
  server: string
  handle: string
  token: string
}

const STORE_KEY = 'mirai.session.v1'

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

function fmtAgo(iso?: string): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.round(ms / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h`
  return `${Math.round(h / 24)} d`
}

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession)
  const [tab, setTab] = useState<'projetos' | 'acoes' | 'arquivos'>('projetos')
  const [projects, setProjects] = useState<ServerProject[]>([])
  const [ops, setOps] = useState<LiveOp[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [server, setServer] = useState(session?.server ?? 'http://127.0.0.1:8787')
  const [handle, setHandle] = useState('')
  const [password, setPassword] = useState('')
  const [dossier, setDossier] = useState<{ doc: ParsedDossier; source: string } | null>(null)
  const sseRef = useRef<AbortController | null>(null)

  const auth = (extra: Record<string, string> = {}) => ({
    ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    ...extra,
  })

  // ---------------------------------------------------------------- conexão

  const connect = useCallback(
    async (s: Session) => {
      setSession(s)
      localStorage.setItem(STORE_KEY, JSON.stringify(s))
      setError(null)
      try {
        const me = await fetch(`${s.server}/me`, { headers: auth({ Authorization: `Bearer ${s.token}` }) })
        if (!me.ok) throw new Error(`a sessão não é válida (HTTP ${me.status})`)
      } catch (e) {
        setError(`não foi falar com o servidor: ${(e as Error).message}`)
      }
      try {
        const res = await fetch(`${s.server}/projects`, { headers: auth() })
        const catalog = (await res.json()) as { projects: ServerProject[] }
        setProjects(catalog.projects ?? [])
      } catch {
        setProjects([])
      }
      try {
        const res = await fetch(`${s.server}/ops`, { headers: auth() })
        const body = (await res.json()) as { ops: LiveOp[] }
        setOps(body.ops ?? [])
      } catch {
        setOps([])
      }
    },
    [session],
  )

  // SSE: os eventos chegam AO VIVO — publicar, progredir, concluir.
  useEffect(() => {
    if (!session) return
    const controller = new AbortController()
    sseRef.current = controller
    const read = async () => {
      let since = 0
      while (!controller.signal.aborted) {
        try {
          const res = await fetch(`${session.server}/events?since=${since}`, {
            headers: auth({ Accept: 'text/event-stream' }),
            signal: controller.signal,
          })
          if (!res.ok || !res.body) throw new Error(`events HTTP ${res.status}`)
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const frames = buffer.split('\n\n')
            buffer = frames.pop() ?? ''
            for (const frame of frames) {
              const idLine = frame.split('\n').find((l) => l.startsWith('id:'))
              const dataLine = frame.split('\n').find((l) => l.startsWith('data:'))
              if (!dataLine) continue
              const event = JSON.parse(dataLine.slice(5).trim()) as {
                seq: number
                type: string
                projectId?: string
                opId?: string
                summary: string
                data?: { progress?: number }
              }
              since = Math.max(since, Number(idLine?.slice(3) ?? event.seq))
              if (event.type === 'project.published' || event.type === 'project.updated') {
                const manifest = event.data as unknown as ServerProject
                setProjects((prev) => {
                  const rest = prev.filter((p) => p.id !== manifest?.id)
                  return manifest?.id ? [manifest, ...rest] : prev
                })
              } else if (event.type === 'project.removed' && event.projectId) {
                setProjects((prev) => prev.filter((p) => p.id !== event.projectId))
              } else if (event.type.startsWith('op.')) {
                setOps((prev) => {
                  const existing = prev.find((o) => o.id === event.opId)
                  const next: LiveOp = existing
                    ? {
                        ...existing,
                        status: event.type === 'op.completed' ? 'COMPLETED' : event.type === 'op.failed' ? 'FAILED' : existing.status,
                        progress: (event.data?.progress as number) ?? existing.progress,
                        message: event.summary,
                      }
                    : { id: event.opId ?? '', kind: event.summary.split(' ')[0] ?? 'op', projectId: event.projectId ?? '', status: event.type.replace('op.', '').toUpperCase(), progress: (event.data?.progress as number) ?? 0, message: event.summary }
                  const rest = prev.filter((o) => o.id !== event.opId)
                  return [next, ...rest].slice(0, 20)
                })
              }
            }
          }
        } catch {
          if (controller.signal.aborted) return
          await new Promise((r) => setTimeout(r, 3_000))
        }
      }
    }
    void read()
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // ---------------------------------------------------------------- auth UI

  const login = async (register: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const path = register ? '/register' : '/login'
      const res = await fetch(`${server}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, password }),
      })
      const body = (await res.json()) as { token?: string; error?: string }
      if (!res.ok || !body.token) throw new Error(body.error ?? `HTTP ${res.status}`)
      await connect({ server, handle, token: body.token })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const logout = () => {
    setSession(null)
    setProjects([])
    setOps([])
    localStorage.removeItem(STORE_KEY)
  }

  // ---------------------------------------------------------------- ações

  const sendOp = async (kind: string, projectId: string, payload: Record<string, unknown> = {}) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${session!.server}/ops`, {
        method: 'POST',
        headers: auth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ kind, projectId, payload }),
      })
      const body = (await res.json()) as { opId?: string; error?: string }
      if (!res.ok || !body.opId) throw new Error(body.error ?? `HTTP ${res.status}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------------------------- arquivo

  const onFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      if (/\.zip$/i.test(file.name)) {
        const texts = readZipTexts(await file.arrayBuffer())
        const found = texts.find((t) => /dossier/i.test(t.name)) ?? texts.find((t) => t.text.startsWith('=='.repeat(10)))
        if (!found) throw new Error('O .zip não contém um dossiê.')
        const parsed = parseDossier(found.text)
        setDossier(parsed && parsed.sections.length > 0 ? { doc: parsed, source: file.name } : null)
      } else {
        const parsed = parseDossier(await file.text())
        if (!parsed || parsed.sections.length === 0) throw new Error('Não é um dossiê do Mirai Studio.')
        setDossier({ doc: parsed, source: file.name })
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------------------------- render

  const style = useMemo(
    () => ({
      minHeight: '100dvh',
      background: 'linear-gradient(160deg, #0a0c12 0%, #120a16 55%, #0a0c12 100%)',
      color: '#e8e6f0',
      fontFamily: 'Inter, system-ui, sans-serif',
      padding: '16px 14px 40px',
    }),
    [],
  )

  if (!session) {
    return (
      <div style={style}>
        <style>{motionCss}</style>
        <div style={{ maxWidth: 420, margin: '0 auto', paddingTop: '10vh' }}>
          <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 28, margin: 0 }}>
            <span style={{ background: 'linear-gradient(90deg,#f472b6,#a78bfa,#22d3ee)', WebkitBackgroundClip: 'text', color: 'transparent' }}>MIRAI STUDIO</span>
          </h1>
          <p style={{ color: '#8b8aa0', fontSize: 13 }}>Companion {APP_VERSION} — o celular como controle do estúdio.</p>
          <label style={{ fontSize: 11, color: '#8b8aa0' }}>Servidor</label>
          <input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            style={input}
            placeholder="http://127.0.0.1:8787"
          />
          <label style={{ fontSize: 11, color: '#8b8aa0' }}>Conta (a mesma do computador)</label>
          <input value={handle} onChange={(e) => setHandle(e.target.value)} style={input} placeholder="seu.handle" />
          <label style={{ fontSize: 11, color: '#8b8aa0' }}>Senha</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={input}
            type="password"
            placeholder="••••••••"
          />
          {error && <p style={errStyle}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={{ ...btn, flex: 1, background: '#f472b6', color: '#0a0c10' }} onClick={() => void login(false)} disabled={busy}>
              Entrar
            </button>
            <button style={{ ...btn, flex: 1 }} onClick={() => void login(true)} disabled={busy}>
              Criar conta
            </button>
          </div>
          <p style={{ fontSize: 11, color: '#5b5a70', marginTop: 16, lineHeight: 1.6 }}>
            Rode o servidor no computador com <code>bun src/cli.ts --with-sync</code>. A mesma conta nos dois
            dispositivos vê a mesma coisa, em tempo real.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={style}>
      <style>{motionCss}</style>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <strong style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: 1 }}>MIRAI COMPANION</strong>
        <span style={{ fontSize: 11, color: '#8b8aa0' }}>{session.handle} ·</span>
        <button style={{ ...btn, fontSize: 11, padding: '4px 10px' }} onClick={logout}>sair</button>
      </header>

      <nav style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(
          [
            ['projetos', `Projetos (${projects.length})`],
            ['acoes', `Ações (${ops.filter((o) => o.status === 'QUEUED' || o.status === 'RUNNING').length})`],
            ['arquivos', 'Arquivos'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              ...btn,
              flex: 1,
              fontSize: 12,
              background: tab === id ? 'rgba(244,114,182,0.16)' : 'transparent',
              borderColor: tab === id ? 'rgba(244,114,182,0.5)' : '#2a2938',
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && <p style={errStyle}>{error}</p>}

      {tab === 'projetos' && (
        <section className="motion-stagger">
          {projects.length === 0 && <p style={{ color: '#8b8aa0', fontSize: 13 }}>Nenhum projeto publicado ainda. Quando o computador publicar, aparece aqui sozinho.</p>}
          {projects.map((p) => (
            <article key={p.id} className="motion-lift" style={card}>
              <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{p.title}</h3>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: '#a5a3bd' }}>{p.tagline || p.summary}</p>
              <p style={{ margin: 0, fontSize: 11, color: '#6d6c84' }}>
                {p.author?.displayName ?? 'anônimo'} · {p.medium ?? 'ANIME'} · {p.downloads ?? 0} downloads · {fmtAgo(p.publishedAt)}
              </p>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <button style={{ ...btn, fontSize: 11 }} onClick={() => void sendOp('produceEpisode', p.id, { targetMinutes: 23 })}>
                  Produzir ep. (23 min)
                </button>
                <button style={{ ...btn, fontSize: 11 }} onClick={() => void sendOp('renderCamera', p.id, {})}>
                  Camera moves (grátis)
                </button>
                <button style={{ ...btn, fontSize: 11 }} onClick={() => void sendOp('speakShot', p.id, {})}>
                  Dublar
                </button>
                <button style={{ ...btn, fontSize: 11 }} onClick={() => void sendOp('render', p.id, {})}>
                  Renderizar
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {tab === 'acoes' && (
        <section className="motion-stagger">
          <p style={{ color: '#8b8aa0', fontSize: 12, marginTop: 0 }}>
            O que você mandou daqui. O computador executa — o progresso chega nos dois ao mesmo tempo.
          </p>
          {ops.length === 0 && <p style={{ color: '#5b5a70', fontSize: 13 }}>Nenhuma operação ainda.</p>}
          {ops.map((op) => (
            <article key={op.id} className="motion-lift" style={{ ...card, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <strong>{op.kind}</strong>
                <span style={{ color: op.status === 'COMPLETED' ? '#4ade80' : op.status === 'FAILED' ? '#f87171' : '#fbbf24' }}>{op.status}</span>
              </div>
              <div style={{ height: 6, background: '#1c1b28', borderRadius: 3, margin: '8px 0 6px' }}>
                <div style={{ height: 6, width: `${op.progress}%`, background: 'linear-gradient(90deg,#f472b6,#a78bfa)', borderRadius: 3, transition: 'width var(--motion-ms) var(--motion-ease)' }} />
              </div>
              <p style={{ margin: 0, fontSize: 11, color: '#8b8aa0' }}>{op.message}</p>
            </article>
          ))}
        </section>
      )}

      {tab === 'arquivos' && (
        <section>
          <p style={{ color: '#8b8aa0', fontSize: 12, marginTop: 0 }}>Abra um dossiê .txt ou um .zip de projeto direto do celular.</p>
          <input type="file" accept=".txt,.zip" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} style={{ fontSize: 12 }} />
          {busy && <p style={{ color: '#8b8aa0', fontSize: 12 }}>lendo…</p>}
          {dossier && (
            <article className="motion-lift" style={{ ...card, marginTop: 12 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{dossier.doc.title ?? dossier.source}</h3>
              {dossier.doc.sections.map((section, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <h4 style={{ margin: '0 0 4px', fontSize: 12, color: '#f472b6', letterSpacing: 0.6 }}>{section.title}</h4>
                  {section.blocks.slice(0, 8).map((block, j) => (
                    <p key={j} style={{ margin: '0 0 3px', fontSize: 11, color: '#a5a3bd', lineHeight: 1.55 }}>
                      {block.kind === 'meta' ? `${block.key}: ${block.value}` : (block.text ?? '')}
                    </p>
                  ))}
                </div>
              ))}
            </article>
          )}
        </section>
      )}
    </div>
  )
}

const input: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  margin: '4px 0 12px',
  background: '#14131f',
  border: '1px solid #2a2938',
  borderRadius: 10,
  color: '#e8e6f0',
  fontSize: 14,
}

const btn: React.CSSProperties = {
  padding: '10px 14px',
  background: '#1a1926',
  border: '1px solid #2a2938',
  borderRadius: 10,
  color: '#e8e6f0',
  fontSize: 14,
  fontWeight: 600,
}

const card: React.CSSProperties = {
  background: 'rgba(20,19,31,0.85)',
  border: '1px solid #2a2938',
  borderRadius: 14,
  padding: 14,
  marginBottom: 10,
}

const errStyle: React.CSSProperties = {
  background: 'rgba(248,113,113,0.12)',
  border: '1px solid rgba(248,113,113,0.4)',
  borderRadius: 10,
  padding: '8px 10px',
  fontSize: 12,
  color: '#fca5a5',
}