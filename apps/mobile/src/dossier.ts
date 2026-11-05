/**
 * Dossier parser — mirrors the desktop DossierService .txt format:
 * sections delimited by '=' lines, '## ' sub-headers, 'Chave: valor' rows.
 */

export interface DossierSection {
  title: string
  blocks: Array<{ kind: 'p' | 'h2' | 'meta'; text?: string; key?: string; value?: string }>
}

export interface ParsedDossier {
  title: string
  subtitle: string
  sections: DossierSection[]
  characters: string[]
  episodes: number
  medium: string
}

const BAR = '='.repeat(72)

export function parseDossier(raw: string): ParsedDossier | null {
  const lines = raw.split(/\r?\n/)
  if (!lines[0]?.startsWith(BAR)) return null
  const title = (lines[1] ?? '').replace(/^DOSSIÊ DE PROJETO — /i, '').trim()
  const subtitle = (lines[2] ?? '').trim()
  const sections: DossierSection[] = []
  let current: DossierSection | null = null

  const push = (block: DossierSection['blocks'][number]) => {
    if (current) current.blocks.push(block)
  }

  for (let i = 3; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line === BAR && (lines[i + 1] ?? '').trim().length > 0) {
      // section header: BAR / TITLE / BAR
      current = { title: (lines[i + 1] ?? '').trim(), blocks: [] }
      sections.push(current)
      i += 2
      continue
    }
    if (!current) continue
    if (/^(FIM DO DOSSIÊ)$/.test(line.trim())) break
    if (line.startsWith('  ## ')) {
      push({ kind: 'h2', text: line.slice(5).trim() })
      continue
    }
    if (line.startsWith('  ') && /^[A-ZÀ-Ú0-9][^:]{1,40}: /.test(line.trim())) {
      const m = /^([^:]{1,40}): (.*)$/.exec(line.trim())
      if (m) {
        push({ kind: 'meta', key: m[1], value: m[2] })
        continue
      }
    }
    if (line.trim().length > 0) {
      push({ kind: 'p', text: line.trim() })
    }
  }

  const ficha = sections.find((s) => /FICHA TÉCNICA/i.test(s.title))
  const metaOf = (k: string) => ficha?.blocks.find((b) => b.kind === 'meta' && b.key === k)?.value ?? '—'
  const cast = sections.find((s) => /BÍBLIA DE PERSONAGENS/i.test(s.title))
  const characterNames = (cast?.blocks ?? [])
    .filter((b): b is { kind: 'h2'; text: string } => b.kind === 'h2')
    .map((b) => b.text.split(' — ')[0] ?? '')
    .filter(Boolean)

  return {
    title: title || 'Dossiê',
    subtitle,
    sections,
    characters: characterNames,
    episodes: Number(metaOf('Episódios/capítulos planejados').match(/\d+/)?.[0] ?? 0),
    medium: metaOf('Matéria / formato'),
  }
}
