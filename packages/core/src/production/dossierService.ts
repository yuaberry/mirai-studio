/**
 * DossierService (v0.15) — the Project Dossier: a professional, commercial
 * planning document generated from the REAL project database (manifest,
 * bibles, characters, episodes/scenes, tasks, QC, analytics) plus
 * AI-enriched strategic sections (executive summary, market positioning,
 * legal advocacy notes). Renders to .txt and a real A4 .pdf.
 *
 * The AI sections are optional: without a configured provider the dossier
 * still renders every data section (aiEnriched=false).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type DossierResult } from '@mirai/shared'
import type { Clock } from '../types'
import { PdfWriter } from './pdfWriter'

/** AI-generated strategic sections (validated upstream by chatJson). */
export interface DossierAiSections {
  executiveSummary: string
  commercialStrategy: string
  marketPositioning: string
  monetization: string
  legalNotes: string
  riskRegister: string[]
  roadmap: string[]
  improvements: string[]
}

/** Everything the dossier renders, gathered from the real services. */
export interface DossierData {
  name: string
  description: string
  medium: string
  title: string
  genres: string[]
  contentRating: string
  language: string
  aspectRatio: string
  resolution: string
  fps: number
  plannedEpisodes: number | null
  appVersion: string
  createdAt: string
  updatedAt: string
  licenseTier: string
  storyBible: Record<string, string | undefined>
  styleBible: Record<string, string | undefined>
  characters: Array<{
    name: string
    role: string
    age?: string
    appearance?: string
    personality?: string
    voice?: string
    backstory?: string
  }>
  episodes: Array<{ season: number; number: number; title: string; synopsis: string; scenes: string[] }>
  tasks: Array<{ title: string; status: string; priority: string; dueDate: string | null }>
  qc: { errors: number; warnings: number; infos: number; top: string[] }
  mediaCount: number
  shotsCount: number
}

export class DossierService {
  constructor(
    private readonly projectRoot: string,
    private readonly clock: Clock,
  ) {}

  /**
   * Renders + writes the dossier. `ai` may be null (provider unconfigured)
   * — every data section still renders.
   */
  generate(data: DossierData, ai: DossierAiSections | null, version: string): DossierResult {
    const sections = this.sections(data, ai, version)
    const txt = this.renderText(data, sections, version)
    const pdf = this.renderPdf(data, sections, version)

    const dir = join(this.projectRoot, 'exports', 'dossier')
    mkdirSync(dir, { recursive: true })
    const stamp = this.clock.isoNow().slice(0, 10)
    const safe = data.name.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'project'
    const txtPath = join(dir, `dossier-${safe}-v${version}-${stamp}.txt`)
    const pdfPath = join(dir, `dossier-${safe}-v${version}-${stamp}.pdf`)
    writeFileSync(txtPath, txt, 'utf8')
    writeFileSync(pdfPath, pdf.bytes)
    return {
      txtPath,
      pdfPath,
      pages: pdf.pages,
      txtBytes: Buffer.byteLength(txt, 'utf8'),
      pdfBytes: pdf.bytes.length,
      version,
      generatedAt: this.clock.isoNow(),
      aiEnriched: ai !== null,
    }
  }

  // ---------------------------------------------------------------- structure

  /** Ordered dossier outline: [heading, paragraphs]. Pure — testable. */
  private sections(data: DossierData, ai: DossierAiSections | null, version: string): Array<{ h1: string; blocks: Array<{ kind: 'p' | 'h2' | 'meta' | 'break'; text?: string; k?: string; v?: string }> }> {
    const out: Array<{ h1: string; blocks: ReturnType<DossierService['sections']>[number]['blocks'] }> = []
    const or = (v: string | undefined | null, fallback = '—') => (v && v.trim().length > 0 ? v : fallback)

    // ---- 1. Ficha técnica
    out.push({
      h1: '1. FICHA TÉCNICA DO PROJETO',
      blocks: [
        { kind: 'meta', k: 'Título da obra', v: or(data.title) },
        { kind: 'meta', k: 'Nome do projeto (arquivo)', v: data.name },
        { kind: 'meta', k: 'Matéria / formato', v: data.medium },
        { kind: 'meta', k: 'Gêneros', v: data.genres.join(', ') || '—' },
        { kind: 'meta', k: 'Classificação de conteúdo', v: data.contentRating },
        { kind: 'meta', k: 'Episódios/capítulos planejados', v: data.plannedEpisodes !== null ? String(data.plannedEpisodes) : 'a definir' },
        { kind: 'meta', k: 'Idioma de produção', v: data.language },
        { kind: 'meta', k: 'Formato de vídeo', v: `${data.aspectRatio} · ${data.resolution} · ${data.fps} fps` },
        { kind: 'meta', k: 'Versão do dossiê', v: `v${version}` },
        { kind: 'meta', k: 'Criado com', v: `Mirai Studio ${data.appVersion}` },
        { kind: 'meta', k: 'Criado em', v: data.createdAt },
        { kind: 'meta', k: 'Última atualização', v: data.updatedAt },
        { kind: 'meta', k: 'Licença do estúdio', v: data.licenseTier },
        { kind: 'p', text: or(data.description, 'Projeto sem descrição cadastrada — recomenda-se registrar um logline de até duas frases na criação.') },
      ],
    })

    // ---- 1b. Sumário do documento
    out.push({
      h1: 'SUMÁRIO DO DOCUMENTO',
      blocks: [
        { kind: 'p', text: '1. Ficha técnica do projeto' },
        { kind: 'p', text: '2. Sumário executivo' },
        { kind: 'p', text: '3. Identidade narrativa — Bíblia da História' },
        { kind: 'p', text: '4. Direção visual — Bíblia de Estilo' },
        { kind: 'p', text: '5. Elenco completo — Bíblia de Personagens' },
        { kind: 'p', text: '6. Plano de episódios/capítulos' },
        { kind: 'p', text: '7. Status de produção' },
        { kind: 'p', text: '8. Estratégia comercial' },
        { kind: 'p', text: '9. Advocacia — fundamentos jurídicos do projeto' },
        { kind: 'p', text: '10. Matriz de riscos' },
        { kind: 'p', text: '11. Roteiro de produção (roadmap)' },
        { kind: 'p', text: '12. Melhorias recomendadas' },
        { kind: 'p', text: '13. Apêndice — configuração integral' },
        { kind: 'p', text: '14. Declaração de titularidade e originalidade' },
        { kind: 'p', text: '15. Glossário de conceitos centrais' },
      ],
    })

    // ---- 2. Sumário executivo (AI or fallback)
    out.push({
      h1: '2. SUMÁRIO EXECUTIVO',
      blocks: [
        {
          kind: 'p',
          text: ai
            ? ai.executiveSummary
            : 'Configure um provedor de IA (Settings → AI) para gerar o sumário executivo, a estratégia comercial e as notas jurídicas automaticamente. As seções de dados abaixo são geradas integralmente a partir do banco do projeto.',
        },
      ],
    })

    // ---- 3. Identidade narrativa (Story Bible)
    const sb = data.storyBible
    out.push({
      h1: '3. IDENTIDADE NARRATIVA — BÍBLIA DA HISTÓRIA',
      blocks: [
        { kind: 'h2', text: 'Premissa' },
        { kind: 'p', text: or(sb.premise) },
        { kind: 'h2', text: 'Temas' },
        { kind: 'p', text: or(sb.themes) },
        { kind: 'h2', text: 'Tom' },
        { kind: 'p', text: or(sb.tone) },
        { kind: 'h2', text: 'Mensagem' },
        { kind: 'p', text: or(sb.message) },
        { kind: 'h2', text: 'Regras narrativas' },
        { kind: 'p', text: or(sb.narrativeRules) },
        { kind: 'h2', text: 'Conceitos centrais' },
        { kind: 'p', text: or(sb.coreConcepts) },
        { kind: 'h2', text: 'Notas de gênero' },
        { kind: 'p', text: or(sb.genreNotes) },
      ],
    })

    // ---- 4. Direção visual (Style Bible)
    const st = data.styleBible
    out.push({
      h1: '4. DIREÇÃO VISUAL — BÍBLIA DE ESTILO',
      blocks: [
        { kind: 'h2', text: 'Direção de arte' },
        { kind: 'p', text: or(st.artDirection) },
        { kind: 'h2', text: 'Lineart' },
        { kind: 'p', text: or(st.lineart) },
        { kind: 'h2', text: 'Sombreado' },
        { kind: 'p', text: or(st.shading) },
        { kind: 'h2', text: 'Paleta' },
        { kind: 'p', text: or(st.palette) },
        { kind: 'h2', text: 'Iluminação' },
        { kind: 'p', text: or(st.lighting) },
        { kind: 'h2', text: 'Proporções' },
        { kind: 'p', text: or(st.proportions) },
        { kind: 'h2', text: 'Olhos e cabelo' },
        { kind: 'p', text: or(st.eyesAndHair) },
        { kind: 'h2', text: 'Fundos' },
        { kind: 'p', text: or(st.backgrounds) },
        { kind: 'h2', text: 'Linguagem de câmera' },
        { kind: 'p', text: or(st.cameraLanguage) },
      ],
    })

    // ---- 5. Elenco completo
    const castBlocks: ReturnType<DossierService['sections']>[number]['blocks'] = []
    if (data.characters.length === 0) {
      castBlocks.push({ kind: 'p', text: 'Nenhum personagem cadastrado ainda. O elenco completo alimentará esta seção automaticamente.' })
    }
    for (const c of data.characters) {
      castBlocks.push({ kind: 'h2', text: `${c.name} — ${c.role}${c.age ? ` (${c.age})` : ''}` })
      castBlocks.push({ kind: 'p', text: `Aparência: ${or(c.appearance)}` })
      castBlocks.push({ kind: 'p', text: `Personalidade: ${or(c.personality)}` })
      if (c.voice) castBlocks.push({ kind: 'p', text: `Voz: ${c.voice}` })
      if (c.backstory) castBlocks.push({ kind: 'p', text: `História: ${c.backstory}` })
      castBlocks.push({ kind: 'p', text: 'Arco do personagem: mapeie aqui o percurso emocional do personagem ao longo da obra — estado inicial, virada, estado final. Um arco claro por personagem é o que separa um elenco profissional de uma lista de nomes; recomenda-se revisar o arco após cada episódio escrito.' })
      castBlocks.push({ kind: 'p', text: 'Função narrativa: registre qual papel estrutural o personagem exerce (espelho do protagonista, catalisador do conflito, âncora emocional, medidor do tema). A função protege o enredo contra personagens redundantes.' })
      castBlocks.push({ kind: 'p', text: 'Relações: liste os vínculos principais (aliados, rivais, familiares) e o que cada relação move na trama. Relações sem função dramática devem ser cortadas ou fundidas.' })
      castBlocks.push({ kind: 'p', text: 'Notas de design e continuidade: capitalize as marcas visuais registradas na aparência (item-símbolo, cicatriz, corte de cabelo) — são âncoras de continuidade para o QC de produção e para o licenciamento de merchandising.' })
      castBlocks.push({ kind: 'p', text: 'Direção de atuação: registre as marcações de voz e postura por ato da temporada (como o personagem fala no início vs. no clímax) — mantém a consistência de performance em cenas gravadas por blocos.' })
    }
    out.push({ h1: '5. ELENCO COMPLETO — BÍBLIA DE PERSONAGENS', blocks: castBlocks })

    // ---- 6. Plano de episódios/capítulos
    const epBlocks: ReturnType<DossierService['sections']>[number]['blocks'] = []
    if (data.episodes.length === 0) {
      epBlocks.push({ kind: 'p', text: `Nenhum episódio/capítulo criado. Planejamento vigente: ${data.plannedEpisodes ?? 'a definir'} unidades.` })
    }
    for (const ep of data.episodes) {
      epBlocks.push({ kind: 'h2', text: `T${ep.season}E${ep.number} — ${ep.title}` })
      epBlocks.push({ kind: 'p', text: `Sinopse: ${or(ep.synopsis)}` })
      if (ep.scenes.length > 0) epBlocks.push({ kind: 'p', text: `Cenas (${ep.scenes.length}): ${ep.scenes.join(' · ')}` })
      epBlocks.push({ kind: 'p', text: 'Estrutura dramática (template): (1) Gancho/cold open — a imagem que segura o espectador nos primeiros 30 segundos; (2) Desenvolvimento — o dia/situação que apresenta o conflito da semana; (3) Virada — a revelação ou escolha que muda a leitura do arco maior; (4) Clímax — o confronto com custo emocional/físico definido pelas regras da Bíblia; (5) Gancho final — a pergunta que leva ao próximo episódio.' })
      epBlocks.push({ kind: 'p', text: 'Checklist de produção por episódio: roteiro fechado e revisado; storyboard completo (todos os shots com frame); vozes gravadas e anexadas; timeline montada com mixdown; QC sem erros pendentes; render MASTER aprovado para arquivamento. Marque cada item somente com a evidência no projeto.' })
      epBlocks.push({ kind: 'p', text: 'Notas comerciais do episódio: registre os momentos com potencial de divulgação (teaser, pôster, corte viral) — alimentam o plano de marketing e o pitch da temporada.' })
    }
    out.push({ h1: '6. PLANO DE EPISÓDIOS/CAPÍTULOS', blocks: epBlocks })

    // ---- 7. Status de produção
    const statusCounts = data.tasks.reduce<Record<string, number>>((acc, t) => {
      acc[t.status] = (acc[t.status] ?? 0) + 1
      return acc
    }, {})
    const statusLine = Object.entries(statusCounts).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'sem tarefas registradas'
    const taskBlocks: ReturnType<DossierService['sections']>[number]['blocks'] = [
      { kind: 'meta', k: 'Cortes de produção', v: `${data.shotsCount} shots · ${data.mediaCount} ativos de mídia` },
      { kind: 'meta', k: 'Quadro de tarefas', v: statusLine },
      { kind: 'meta', k: 'Quality Control', v: `${data.qc.errors} erros · ${data.qc.warnings} avisos · ${data.qc.infos} informativos` },
    ]
    if (data.qc.top.length > 0) {
      taskBlocks.push({ kind: 'h2', text: 'Principais apontamentos do QC' })
      for (const t of data.qc.top) taskBlocks.push({ kind: 'p', text: `• ${t}` })
    }
    const overdue = data.tasks.filter((t) => t.dueDate && t.status !== 'APPROVED' && t.status !== 'FINAL')
    if (overdue.length > 0) {
      taskBlocks.push({ kind: 'h2', text: 'Tarefas com prazo' })
      for (const t of overdue.slice(0, 20)) taskBlocks.push({ kind: 'p', text: `• ${t.title} — vence ${t.dueDate} (${t.status}, ${t.priority})` })
    }
    out.push({ h1: '7. STATUS DE PRODUÇÃO', blocks: taskBlocks })

    // ---- 8. Estratégia comercial (AI or fallback)
    out.push({
      h1: '8. ESTRATÉGIA COMERCIAL',
      blocks: [
        { kind: 'h2', text: 'Posicionamento de mercado' },
        { kind: 'p', text: ai ? ai.marketPositioning : 'Seção gerada por IA quando um provedor estiver configurado.' },
        { kind: 'h2', text: 'Modelo de monetização' },
        { kind: 'p', text: ai ? ai.monetization : 'Seção gerada por IA quando um provedor estiver configurado.' },
        { kind: 'h2', text: 'Plano comercial integral' },
        { kind: 'p', text: ai ? ai.commercialStrategy : 'Seção gerada por IA quando um provedor estiver configurado.' },
      ],
    })

    // ---- 9. Advocacia & jurídico
    const legalBlocks: ReturnType<DossierService['sections']>[number]['blocks'] = [
      {
        kind: 'p',
        text:
          'Esta seção consolida o arcabouço jurídico brasileiro aplicável à produção, exploração comercial e proteção da obra. Fundamentos invocáveis em favor do projeto:',
      },
      { kind: 'h2', text: '9.1 Liberdade de expressão e de criação' },
      {
        kind: 'p',
        text:
          'Constituição Federal, art. 5º, incisos IX (livre expressão da atividade intelectual, proibida censura) e XXVII (proteção às criações); art. 220 (manifestação do pensamento e da criação é livre). O projeto exerce atividade intelectual lícita com plena proteção constitucional.',
      },
      { kind: 'h2', text: '9.2 Direitos autorais' },
      {
        kind: 'p',
        text:
          'Lei nº 9.610/1998 (Lei de Direitos Autorais): a obra é protegida independentemente de registro (art. 5º, §1º e art. 18); o registro na Biblioteca Nacional/Fundação Casa de Rui Barbosa é facultativo e vale como prova de anterioridade (art. 19). Direitos morais são inalienáveis (art. 27); direitos patrimoniais permitem licenciamento e cessão (arts. 28 a 31).',
      },
      { kind: 'h2', text: '9.3 Proteção de dados dos envolvidos' },
      {
        kind: 'p',
        text:
          'Lei nº 13.709/2018 (LGPD): a produção observa os princípios de finalidade, necessidade e transparência no tratamento de dados de equipe e elenco; o estúdio opera de forma local-first, minimizando coleta. Base legal aplicável: art. 7º, V e VII (execução de políticas públicas; proteção da saúde/interesse público) e art. 10 (interesse legítimo).',
      },
      { kind: 'h2', text: '9.4 Incentivos ao audiovisual e à economia criativa' },
      {
        kind: 'p',
        text:
          'Lei nº 8.685/1993 (Lei do Audiovisual — captação via renúncia fiscal, art. 1º e 3º); Lei nº 14.216/2021 (Lei Paulo Gustavo — apoio à cultura, aplicável a estados e municípios); Lei nº 12.485/2011 (SeAC — distribuição de canais/programadoras); Art. 1º da Lei nº 11.437/2006 (incentivo à produção de obras audiovisuais brasileiras independentes). O projeto qualifica-se como obra audiovisual independente nacional para fins de fomento.',
      },
      { kind: 'h2', text: '9.5 Contratos e exploração' },
      {
        kind: 'p',
        text:
          'Código Civil, arts. 421 (função social do contrato) e 104 a 114 (validade dos negócios jurídicos): cessões de direitos, licenciamento de merchandising e contratos de distribuição seguem os requisitos de validade. Recomenda-se formalizar: cessão de direitos patrimoniais por escrito (LDA art. 33), acordos de co-produção e liberações de uso de imagem/voz do elenco.',
      },
      { kind: 'h2', text: '9.6 Notas jurídicas específicas do projeto' },
      { kind: 'p', text: ai ? ai.legalNotes : 'Notas específicas geradas por IA quando um provedor estiver configurado.' },
      {
        kind: 'p',
        text:
          'DISCLAIMER: este dossiê é um documento de planejamento e organização comercial. Não constitui parecer jurídico formal; para contratos e litígios, consulte advogado inscrito na OAB.',
      },
    ]
    out.push({ h1: '9. ADVOCACIA — FUNDAMENTOS JURÍDICOS DO PROJETO', blocks: legalBlocks })

    // ---- 10. Riscos + roadmap + melhorias
    const riskBlocks: ReturnType<DossierService['sections']>[number]['blocks'] = []
    if (ai) {
      for (const r of ai.riskRegister) riskBlocks.push({ kind: 'p', text: `• ${r}` })
      if (ai.riskRegister.length === 0) riskBlocks.push({ kind: 'p', text: 'Nenhum risco material identificado na análise.' })
    } else {
      riskBlocks.push({ kind: 'p', text: 'Seção gerada por IA quando um provedor estiver configurado.' })
    }
    out.push({ h1: '10. MATRIZ DE RISCOS', blocks: riskBlocks })

    const roadBlocks: ReturnType<DossierService['sections']>[number]['blocks'] = []
    if (ai) {
      for (const r of ai.roadmap) roadBlocks.push({ kind: 'p', text: `• ${r}` })
    } else {
      roadBlocks.push({ kind: 'p', text: 'Seção gerada por IA quando um provedor estiver configurado.' })
    }
    out.push({ h1: '11. ROTEIRO DE PRODUÇÃO (ROADMAP)', blocks: roadBlocks })

    const impBlocks: ReturnType<DossierService['sections']>[number]['blocks'] = []
    if (ai) {
      for (const i of ai.improvements) impBlocks.push({ kind: 'p', text: `• ${i}` })
    } else {
      impBlocks.push({ kind: 'p', text: 'Seção gerada por IA quando um provedor estiver configurado.' })
    }
    out.push({ h1: '12. MELHORIAS RECOMENDADAS', blocks: impBlocks })

    // ---- 14. Declaração de titularidade e originalidade
    out.push({
      h1: '14. DECLARAÇÃO DE TITULARIDADE E ORIGINALIDADE',
      blocks: [
        {
          kind: 'p',
          text: `O presente projeto (${data.title}, ${data.medium}) é obra intelectual original, criada e produzida no âmbito do estúdio com o suporte da suíte Mirai Studio, sem cópia, adaptação não autorizada ou derivação de obras de terceiros. Personagens, enredo, conceitos e identidade visual foram desenvolvidos originalmente para esta obra.`,
        },
        {
          kind: 'p',
          text: 'Nos termos da Lei nº 9.610/1998 (art. 5º, §1º, e art. 18), a proteção dos direitos autorais independe de registro; o registro na Biblioteca Nacional, quando realizado, serve como prova de anterioridade (art. 19). O estúdio mantém, no banco de dados do projeto, o histórico de criação (datas de criação e atualização de cada elemento) que documenta a gênese autoral da obra.',
        },
        {
          kind: 'p',
          text: 'O estúdio declara que eventuais semelhanças com obras de terceiros são casuais e não derivam de acesso a material confidencial; recomenda-se a busca de anterioridade (título e conceito) nos registros públicos antes da divulgação comercial.',
        },
        {
          kind: 'p',
          text: 'Este dossiê, gerado automaticamente a partir do banco de dados do projeto, serve como memorial técnico e documentação de maturidade do pipeline de produção, podendo ser apresentado a produtoras, distribuidores, festivals e órgãos de fomento como evidência de planejamento profissional.',
        },
      ],
    })

    // ---- 13. Apêndice: configuração técnica integral
    out.push({
      h1: '13. APÊNDICE — CONFIGURAÇÃO INTEGRAL',
      blocks: [
        { kind: 'meta', k: 'Gêneros (tags)', v: data.genres.join(', ') || '—' },
        { kind: 'meta', k: 'Matéria', v: data.medium },
        { kind: 'meta', k: 'Classificação', v: data.contentRating },
        { kind: 'meta', k: 'Idioma', v: data.language },
        { kind: 'meta', k: 'Proporção', v: data.aspectRatio },
        { kind: 'meta', k: 'Resolução', v: data.resolution },
        { kind: 'meta', k: 'FPS', v: String(data.fps) },
        { kind: 'meta', k: 'Personagens cadastrados', v: String(data.characters.length) },
        { kind: 'meta', k: 'Episódios cadastrados', v: String(data.episodes.length) },
        { kind: 'meta', k: 'Cenas', v: String(data.episodes.reduce((n, e) => n + e.scenes.length, 0)) },
        { kind: 'meta', k: 'Shots', v: String(data.shotsCount) },
        { kind: 'meta', k: 'Ativos de mídia', v: String(data.mediaCount) },
        {
          kind: 'p',
          text:
            'Documento gerado automaticamente pelo Mirai Studio a partir do banco de dados do projeto — cada seção reflete o estado real da produção no momento da geração. Regenerar o dossiê após marcos importantes mantém a documentação comercial sempre atualizada.',
        },
      ],
    })

    // ---- 15. Glossário de conceitos centrais
    const glossary = (sb.coreConcepts ?? '')
      .split(/[;·\n]/)
      .map((g) => g.trim())
      .filter((g) => g.length > 0)
      .slice(0, 12)
    const glossaryBlocks: ReturnType<DossierService['sections']>[number]['blocks'] = []
    if (glossary.length === 0) {
      glossaryBlocks.push({ kind: 'p', text: 'Nenhum conceito central registrado na Bíblia da História — preencha o campo Conceitos Centrais para alimentar o glossário (padrão: conceito; definição em uma frase).' })
    }
    for (const g of glossary) {
      glossaryBlocks.push({ kind: 'p', text: `• ${g}` })
    }
    glossaryBlocks.push({
      kind: 'p',
      text: 'Recomenda-se manter o glossário como contrato de terminologia da obra: nomeações, sistemas e regras usadas em roteiro, storyboard e marketing devem vir sempre daqui, evitando deriva de nomes entre materiais.',
    })
    out.push({ h1: '15. GLOSSÁRIO DE CONCEITOS CENTRAIS', blocks: glossaryBlocks })

    return out
  }

  // ---------------------------------------------------------------- renderers

  private renderText(data: DossierData, sections: ReturnType<DossierService['sections']>, version: string): string {
    const bar = '='.repeat(72)
    const head = [
      bar,
      `DOSSIÊ DE PROJETO — ${data.title.toUpperCase()}`,
      `${data.medium} · Mirai Studio v${data.appVersion} · dossiê v${version}`,
      `Gerado em ${this.clock.isoNow()}`,
      bar,
      '',
    ].join('\n')
    const body = sections
      .map((s) => {
        const blocks = s.blocks
          .map((b) => {
            if (b.kind === 'h2') return `\n  ## ${b.text}`
            if (b.kind === 'meta') return `  ${b.k}: ${b.v}`
            if (b.kind === 'break') return ''
            return b.text ?? ''
          })
          .join('\n')
        return `${bar}\n${s.h1}\n${bar}\n${blocks}\n`
      })
      .join('\n')
    return `${head}${body}\n${bar}\nFIM DO DOSSIÊ\n${bar}\n`
  }

  private renderPdf(data: DossierData, sections: ReturnType<DossierService['sections']>, version: string): { bytes: Buffer; pages: number } {
    const pdf = new PdfWriter(`${data.title} — dossiê v${version}`)
    // Cover page.
    pdf.spacer(210)
    pdf.paragraph(`DOSSIÊ DE PROJETO`, { italic: false })
    pdf.spacer(8)
    // A big visual title: reuse paragraph but with heading sizes via heading1.
    pdf.heading1(data.title.toUpperCase())
    pdf.spacer(6)
    pdf.paragraph(`${data.medium} · classificação ${data.contentRating}`)
    pdf.spacer(16)
    pdf.metaLine('Versão do dossiê', `v${version}`)
    pdf.metaLine('Produzido com', `Mirai Studio ${data.appVersion}`)
    pdf.metaLine('Gerado em', this.clock.isoNow())
    pdf.metaLine('Gêneros', data.genres.join(', ') || '—')
    pdf.pageBreak()

    for (const s of sections) {
      pdf.pageBreak() // formal documents: every section opens on a fresh page
      pdf.heading1(s.h1)
      for (const b of s.blocks) {
        if (b.kind === 'h2') pdf.heading2(b.text ?? '')
        else if (b.kind === 'meta') pdf.metaLine(b.k ?? '', b.v ?? '')
        else if (b.kind === 'break') pdf.spacer(12)
        else if (b.text) pdf.paragraph(b.text)
      }
      pdf.spacer(10)
    }
    return pdf.build()
  }
}
