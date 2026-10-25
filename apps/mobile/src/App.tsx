/**
 * Mirai Studio Companion — read the Project Dossier (.txt) and project
 * archives (.zip) on your phone. Mobile reading companion for the desktop
 * studio: open the dossier you generated in Mirai Studio (share it to the
 * app, pick it from Files, or open a project .zip) and read the whole
 * commercial plan anywhere.
 */
import { useMemo, useState } from 'react'
import { parseDossier, type ParsedDossier } from './dossier'
import { readZipTexts } from './zip'

const APP_VERSION = '0.16.0'

type Screen = { kind: 'home' } | { kind: 'dossier'; doc: ParsedDossier; source: string }

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'home' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const openText = (name: string, text: string) => {
    const parsed = parseDossier(text)
    if (!parsed || parsed.sections.length === 0) {
      setError(`"${name}" não parece um dossiê do Mirai Studio (gerado em Overview → Generate dossier).`)
      return
    }
    setError(null)
    setScreen({ kind: 'dossier', doc: parsed, source: name })
  }

  const onFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      if (/\.zip$/i.test(file.name)) {
        const texts = readZipTexts(await file.arrayBuffer())
        const dossier = texts.find((t) => /dossier/i.test(t.name) && t.text.startsWith('=='.repeat(10)))
          ?? texts.find((t) => t.text.startsWith('=='.repeat(10)))
        const manifestTxt = texts.find((t) => /manifest\.json$/i.test(t.name))
        if (manifestTxt) {
          try {
            const m = JSON.parse(manifestTxt.text)
            if (!dossier && m?.config?.title) {
              openText(file.name, buildFallbackDossier(m))
              return
            }
          } catch { /* fall through to dossier search */ }
        }
        if (!dossier) throw new Error('O .zip não contém um dossiê .txt (gere um em Overview → Generate dossier e compacte junto).')
        openText(dossier.name, dossier.text)
      } else {
        openText(file.name, await file.text())
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const input = (accept: string, label: string) => (
    <label className="file-button">
      <input
        type="file"
        accept={accept}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onFile(f)
          e.target.value = ''
        }}
      />
      {label}
    </label>
  )

  if (screen.kind === 'dossier') {
    return <DossierView doc={screen.doc} source={screen.source} onBack={() => setScreen({ kind: 'home' })} />
  }

  return (
    <div className="app">
      <header className="hero">
        <p className="hero-title">Mirai Studio</p>
        <p className="hero-sub">Companion — leitor de Dossiê</p>
        <p className="hero-version">v{APP_VERSION}</p>
      </header>

      <section className="card actions">
        <p className="hint">
          Abra o dossiê gerado pelo Mirai Studio no seu computador (Overview → Generate dossier):
          compartilhe o <strong>.txt</strong> com o celular, ou escolha um <strong>.zip</strong> do
          projeto contendo o dossiê.
        </p>
        {busy ? <p className="busy">Lendo…</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <div className="buttons">
          {input('.txt,text/plain', 'Abrir dossiê (.txt)')}
          {input('.zip,application/zip', 'Abrir projeto (.zip)')}
        </div>
      </section>

      <section className="card about">
        <p className="about-title">Como usar</p>
        <ol>
          <li>No desktop: abra seu projeto → Overview → <strong>Generate dossier</strong></li>
          <li>Compartilhe o arquivo <code>.txt</code> (WhatsApp, Drive, cabo…) com o celular</li>
          <li>Toque em <strong>Abrir dossiê</strong> e escolha o arquivo</li>
        </ol>
        <p className="fine">
          100% offline — nada sai do seu aparelho. O companion apenas LÊ; edição e geração
          continuam no desktop.
        </p>
      </section>
    </div>
  )
}

/** Builds a minimal dossier-like view from a manifest.json when the zip has no dossier yet. */
function buildFallbackDossier(manifest: {
  name?: string
  config?: { title?: string; genres?: string[]; episodeCount?: number; contentRating?: string }
}): string {
  const c = manifest.config ?? {}
  return [
    '========'.padEnd(72, '='),
    `DOSSIÊ DE PROJETO — ${(c.title ?? manifest.name ?? 'Projeto').toUpperCase()}`,
    'Resumo do manifest.json (gere o dossiê completo no desktop)',
    '========'.padEnd(72, '='),
    '1. FICHA TÉCNICA',
    '========'.padEnd(72, '='),
    `  Título da obra: ${c.title ?? '—'}`,
    `  Nome do projeto (arquivo): ${manifest.name ?? '—'}`,
    `  Gêneros: ${(c.genres ?? []).join(', ') || '—'}`,
    `  Episódios/capítulos planejados: ${c.episodeCount ?? 'a definir'}`,
    `  Classificação de conteúdo: ${c.contentRating ?? '—'}`,
    '  Episódios criados: 0',
    '========'.padEnd(72, '='),
    'MELHORIAS RECOMENDADAS',
    '========'.padEnd(72, '='),
    'Gere o dossiê completo no desktop (Overview → Generate dossier) para ver estratégia comercial, advocacy e plano de episódios aqui no celular.',
  ].join('\n')
}

function DossierView({ doc, source, onBack }: { doc: ParsedDossier; source: string; onBack: () => void }) {
  const [active, setActive] = useState(0)
  const section = useMemo(() => doc.sections[active], [doc, active])

  return (
    <div className="app">
      <header className="bar">
        <button className="back" onClick={onBack}>←</button>
        <div className="bar-title">
          <p className="doc-title">{doc.title}</p>
          <p className="doc-sub">{doc.subtitle || source}</p>
        </div>
      </header>

      {(doc.medium !== '—' || doc.episodes > 0 || doc.characters.length > 0) && (
        <div className="chips">
          <span className="chip">{doc.medium}</span>
          {doc.episodes > 0 ? <span className="chip">{doc.episodes} eps</span> : null}
          {doc.characters.length > 0 ? (
            <span className="chip">{doc.characters.length} personagens</span>
          ) : null}
        </div>
      )}

      <nav className="toc">
        {doc.sections.map((s, i) => (
          <button
            key={s.title}
            className={i === active ? 'toc-item active' : 'toc-item'}
            onClick={() => setActive(i)}
          >
            {s.title.replace(/^\d+\.\s*/, '')}
          </button>
        ))}
      </nav>

      <main className="section">
        <h1 className="section-title">{section.title}</h1>
        {section.blocks.map((b, i) => {
          if (b.kind === 'h2') return <h2 key={i} className="block-h2">{b.text}</h2>
          if (b.kind === 'meta')
            return (
              <p key={i} className="meta">
                <span className="meta-key">{b.key}</span>
                <span className="meta-value">{b.value}</span>
              </p>
            )
          return <p key={i} className="paragraph">{b.text}</p>
        })}
      </main>
    </div>
  )
}
