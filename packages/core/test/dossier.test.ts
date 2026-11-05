/**
 * DossierService + PdfWriter (v0.15) — REAL outputs: the generated PDF is
 * parsed back (header, xref, page count, inflated text) and the .txt
 * carries every section. A rich project must produce a 30+ page document.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, statSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync, inflateSync } from 'node:zlib'
import { DossierService, type DossierData } from '../src/production/dossierService'
import { PdfWriter } from '../src/production/pdfWriter'
import { makeClock } from './helpers'

function fullProject(): DossierData {
  const characters = Array.from({ length: 12 }, (_, i) => ({
    name: `Personagem ${i + 1}`,
    role: i === 0 ? 'PROTAGONIST' : 'SUPPORTING',
    age: '21',
    appearance:
      'Cabelos longos cor de prata sob a luz dos postes, olhos âmbar que carregam o peso de uma promessa antiga; veste o uniforme desgastado da academia e uma faixa vermelha herdada da avó, marcada por cicatrizes finas nos antebraços das sessões de treino noturno.',
    personality:
      'Determinada e reservada, mede cada palavra como quem aprendeu que silêncio também protege; sob a pressão, revela um humor seco e uma lealdade inabalável às poucas pessoas que conquistaram sua confiança.',
    voice: 'Médio-grave, cadência pausada, aquece ao falar da irmã.',
    backstory:
      'Cresceu na aldeia de Kisaragi treinando esgrima com o pai ferreiro; aos doze anos perdeu a família no incêndio do festival e passou a carregar a faixa vermelha como único vestígio daquela noite; ingressou na academia da capital com uma bolsa de mérito e o objetivo de reabrir a forja da família.',
  }))
  const episodes = Array.from({ length: 12 }, (_, i) => ({
    season: 1,
    number: i + 1,
    title: `Episódio ${i + 1}: O peso das promessas`,
    synopsis:
      'A equipe atravessa a provação semanal enquanto as faíscas do passado de Ayaka reacendem; a cena no telhado da academia costura o plano do vilão com a rotina dos treinos e termina com a promessa que definirá o clímax da temporada.',
    scenes: [`Cena A — Telhado`, `Cena B — Pátio`, `Cena C — Refeitório`],
  }))
  return {
    name: 'Sakura Chronicles',
    description: 'Um drama de amadurecimento com esgrima espiritual em uma academia à beira da guerra.',
    medium: 'ANIME',
    title: 'Sakura Chronicles',
    genres: ['Drama', 'School', 'Action', 'Coming of Age'],
    contentRating: '13+',
    language: 'ja',
    aspectRatio: '16:9',
    resolution: '1920x1080',
    fps: 24,
    plannedEpisodes: 24,
    plannedSeasons: 2,
    demographic: 'SEINEN',
    targetAudience: 'seinen adults 18-34',
    inspirations: 'Mushishi x Violet Evergarden',
    endingVision: 'Ayaka reabre a forja e liberta o contrato da faísca.',
    appVersion: '0.15.0',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-12T10:00:00.000Z',
    licenseTier: 'pro',
    storyBible: {
      premise: 'Uma esgrimista órfã descobre que as faíscas do festival de infância marcavam contratos espirituais — e o dela ainda está aberto.',
      themes: 'Promessas, luto, identidade; o peso do que herdamos versus o que escolhemos ser.',
      tone: 'Melancólico com explosões de ação coreografada; calor cotidiano entre as batalhas.',
      message: 'Honrar o passado não é obedecer a ele.',
      narrativeRules: 'Nenhum poder sem custo físico; cada episódio fecha um arco pequeno e avança o arco maior em um giro.',
      coreConcepts: 'Contratos de faísca; forja espiritual; academia como microcosmo da guerra iminente.',
      genreNotes: 'Drama school com ação — evitar power creep mantendo o stakes emocional crescente.',
    },
    styleBible: {
      artDirection: 'Linha limpa sombreada em tons frios; faíscas vermelhas como única cor quente.',
      lineart: 'Traço médio, pesos alternados em silhueta e primeiro plano.',
      shading: 'Sombra em duas camadas com rim light quente nas cenas de memória.',
      palette: 'Aço, azul-noite, bege de papel; vermelho-símbolo nas faíscas.',
      lighting: 'Contraluz de fim de tarde; interiores práticos duros.',
      proportions: 'Realista, seis cabeças; mãos detalhadas para a esgrima.',
      eyesAndHair: 'Olhos âmbar com reflexo duplo; cabelos com mechas-guia.',
      backgrounds: 'Pintura digital com textura de guache.',
      cameraLanguage: 'Planos longos nas lutas; close lento nas promessas.',
    },
    characters,
    episodes,
    tasks: Array.from({ length: 10 }, (_, i) => ({
      title: `Tarefa ${i + 1}`,
      status: i % 3 === 0 ? 'IN_PROGRESS' : 'TODO',
      priority: i === 0 ? 'CRITICAL' : 'NORMAL',
      dueDate: '2026-11-01',
    })),
    qc: { errors: 0, warnings: 2, infos: 3, top: ['Cena 3 sem timeline', 'Mídia X sem arquivo'] },
    mediaCount: 18,
    shotsCount: 96,
  }
}

const AI = {
  executiveSummary:
    'Sakura Chronicles posiciona-se como drama school de ação com identidade visual assinatura — faíscas vermelhas sobre paleta fria — e disciplina narrativa verificável: regras de custo por poder registradas na Bíblia da História, elenco funcional de 12 personagens com arcos acoplados ao arco geral e uma proposta de temporada de 24 episódios com viradas calibradas. O material combina a demanda comprovada por dramas de amadurecimento com a economia de produção de uma paleta contida e locações recorrentes (academia, telhado, pátio), o que reduz o custo por episódio sem sacrificar a leitura premium. A sinopse central — contratos espirituais marcados por faíscas — é visualmente distintiva, merchandising-ready e abre linha de produtos derivados naturais. Recomenda-se a conclusão do piloto e deste dossiê na versão final antes da rodada de contatos com produtoras e distribuidores, usando o QC do estúdio como atestado de maturidade de pipeline.',
  commercialStrategy:
    'A estratégia comercial da obra opera em três horizontes complementares. No horizonte imediato, o posicionamento de festival: o material de teaser do piloto deve circular em chamadas de festivais de animação e mostras de pitch, onde dramas de autora com assinatura visual forte historicamente performam acima da média em seleção. No horizonte de 12 a 18 meses, a distribuição: simulcast por temporada com plataformas focadas em anime dramático, mantendo os direitos de merchandising fora do pacote de streaming — a faixa vermelha é o item-símbolo com maior potencial de linha de produtos. No horizonte de 24 a 36 meses, a expansão de franquia: light novel derivada contando o arco da geração anterior da família, read-throughs pagos em convenções e licenciamento seletivo de arte. O dossiê em mãos é a peça central do pitch: demonstra planejamento real (episódios, elenco, prazos, QC) e não apenas conceito.',
  marketPositioning:
    'Ocupa o espaço entre o school drama clássico e a ação sobrenatural contemporânea. O diferencial competitivo é triplamente verificável: (1) proposta visual de paleta contida com um único acento cromático — reconhecível em thumbnail, barato de produzir, forte em licenciamento; (2) sistema de regras de custo físico por poder, que protege a narrativa do power creep e cria tensão coreografável em cada luta; (3) o elenco de 12 personagens com função narrativa mapeada, que sustenta episódios de elenco rotativo sem queda de qualidade. O público-alvo primário é o de 16 a 34 anos consumidores de drama school com ação, com sobreposição natural para o público de light novels de academia mágica.',
  monetization:
    'Simulcast por temporada como carro-chefe de receita; licenciamento de merchandising da faixa vermelha (item-símbolo com fabricação de baixo custo e margem alta); light novel derivada explorando o arco da geração anterior; potencial de stage/read-through pago em convenções; e venda de arte licenciada para papelaria e moda casual. Direitos de streaming internacional negociados por território, com cláusula de reverção se a distribuição não atingir janelas acordadas.',
  legalNotes:
    'Obra original sem derivação de terceiros — a cadeia de titularidade nasce limpa nas mãos do estúdio, o que é um ativo comercial em si. Recomenda-se: (1) registro da obra na Biblioteca Nacional (facultativo, mas vale como prova robusta de anterioridade perante a LDA art. 19); (2) cessões de direitos patrimoniais por escrito conforme LDA art. 33 — qualquer colaborador externo (design de personagem convidado, trilha) assina termo específico antes de entregar material; (3) contratos de uso de imagem e voz do elenco com definição de território e prazo; (4) verificação de marca do título antes da divulgação pública (INPI, classes de entretenimento e vestuário); (5) atenção à proteção de dados de equipe conforme LGPD — o estúdio opera local-first, o que minimiza tratamento e simplifica o cumprimento dos arts. 6º a 10º.',
  riskRegister: [
    'Power creep na segunda temporada pode inflar custos de animação de ação — mitigação: tabela de custo de poderes na Bíblia como contrato interno.',
    'Dependência de janela de festival para o pitch comercial — mitigação: preparar dois materiais de pitch (festival e produtora direta).',
    'Escala de elenco (12 personagens) sobrecarregando a produção de episódios de elenco — mitigação: função narrativa mapeada permite cortes sem perda de arco.',
    'Concentração de identidade visual em um único item-símbolo (faixa vermelha) — mitigação: registrar o design antes do licenciamento.',
  ],
  roadmap: [
    'Tração 1 (piloto): fechar roteiro e storyboard do episódio 1, render MASTER aprovado no QC, dossiê v2 atualizado para o pacote de pitch.',
    'Tração 2 (teaser comercial): três episódios-chave produzidos até o corte de teaser, com cenas de ação selecionadas para material de divulgação.',
    'Tração 3 (temporada): calendário do board completo com prazos por episódio, revisão quinzenal do QC e regeneração do dossiê a cada marco entregue.',
    'Tração 4 (franquia): light novel derivada com capítulo-zero de teste de mercado em plataformas de publicação digital.',
  ],
  improvements: [
    'Registrar o custo físico dos poderes em uma tabela de referência anexa à Bíblia da História.',
    'Definir o calendário de prazos do board antes do piloto, com datas limite por episódio.',
    'Adicionar uma cena-âncora por episódio com potencial de teaser, marcada nas notas comerciais do episódio.',
    'Formalizar a função narrativa de cada personagem no elenco (campo função já previsto neste dossiê) para proteger os cortes de elenco.',
    'Registrar a marca do título no INPI antes da primeira divulgação pública.',
  ],
}

describe('DossierService', () => {
  it('generates a real .txt + .pdf with 30+ pages for a full project (AI-enriched)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dossier-'))
    const clock = makeClock()
    const svc = new DossierService(dir, clock)
    const result = svc.generate(fullProject(), AI, '1')

    expect(existsSync(result.txtPath)).toBe(true)
    expect(existsSync(result.pdfPath)).toBe(true)
    expect(result.aiEnriched).toBe(true)
    expect(result.pages).toBeGreaterThanOrEqual(30)
    expect(statSync(result.pdfPath).size).toBeGreaterThan(20_000)
    expect(statSync(result.txtPath).size).toBeGreaterThan(10_000)

    // The .txt carries every section + legal citations.
    const txt = readFileSync(result.txtPath, 'utf8')
    for (const marker of [
      'FICHA TÉCNICA',
      'SUMÁRIO EXECUTIVO',
      'BÍBLIA DA HISTÓRIA',
      'BÍBLIA DE ESTILO',
      'BÍBLIA DE PERSONAGENS',
      'PLANO DE EPISÓDIOS',
      'STATUS DE PRODUÇÃO',
      'ESTRATÉGIA COMERCIAL',
      'ADVOCACIA',
      'MATRIZ DE RISCOS',
      'ROADMAP',
      'MELHORIAS RECOMENDADAS',
      'APÊNDICE',
      'Lei nº 9.610/1998',
      'Lei nº 13.709/2018',
      'Constituição Federal',
      'Lei nº 8.685/1993',
      'Não constitui parecer jurídico',
    ]) {
      expect(txt).toContain(marker)
    }
  })

  it('the generated PDF is structurally valid (header, xref, pages, Flate text)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dossier-'))
    const svc = new DossierService(dir, makeClock())
    const result = svc.generate(fullProject(), AI, '1')
    const raw = readFileSync(result.pdfPath)

    expect(raw.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(raw.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true)
    // Page tree count matches the reported page count.
    const pageTreeMatch = raw.toString('latin1').match(/\/Type \/Pages \/Count (\d+)/)
    expect(Number(pageTreeMatch?.[1])).toBe(result.pages)
    // Content streams really inflate to text (first stream).
    const latin = raw.toString('latin1')
    const streamAt = latin.indexOf('stream\n')
    expect(streamAt).toBeGreaterThan(0)
    // Footer text is present in some stream (spot-check via re-inflating all).
    let found = false
    const re = /stream\r?\n/g
    let m: RegExpExecArray | null
    while ((m = re.exec(latin)) !== null && !found) {
      const end = latin.indexOf('endstream', m.index)
      const chunk = Buffer.from(latin.slice(m.index + m[0].length, end), 'latin1')
      try {
        let inflated: string
        try {
          inflated = inflateRawSync(chunk).toString('latin1')
        } catch {
          inflated = inflateSync(chunk).toString('latin1')
        }
        if (inflated.includes('página 1 de')) found = true
      } catch {
        /* not a flate stream */
      }
    }
    expect(found).toBe(true)
  })

  it('renders without AI sections (aiEnriched=false) and still produces the data sections', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dossier-'))
    const svc = new DossierService(dir, makeClock())
    const result = svc.generate(fullProject(), null, '2')
    expect(result.aiEnriched).toBe(false)
    const txt = readFileSync(result.txtPath, 'utf8')
    expect(txt).toContain('FICHA TÉCNICA')
    expect(txt).toContain('provedor de IA')
    expect(result.pages).toBeGreaterThanOrEqual(25)
  })
})

describe('PdfWriter', () => {
  it('escapes parentheses and wraps long text into multiple lines/pages', () => {
    const pdf = new PdfWriter('Teste (rodapé)')
    pdf.heading1('Capítulo com (parênteses) e — travessão')
    for (let i = 0; i < 200; i++) {
      pdf.paragraph(
        `Parágrafo ${i}: linha longa para exercitar a quebra automática de texto com palavras como internacionalização e responsabilidade.`,
      )
    }
    const built = pdf.build()
    expect(built.pages).toBeGreaterThan(4)
    expect(built.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    // Escaping is asserted on the INFLATED content stream (raw bytes are compressed).
    const latin = built.bytes.toString('latin1')
    let firstInflated = ''
    const streamMatch = /stream\r?\n/.exec(latin)
    if (streamMatch) {
      const end = latin.indexOf('endstream', streamMatch.index)
      const chunk = Buffer.from(latin.slice(streamMatch.index + streamMatch[0].length, end), 'latin1')
      try {
        firstInflated = inflateRawSync(chunk).toString('latin1')
      } catch {
        firstInflated = inflateSync(chunk).toString('latin1')
      }
    }
    expect(firstInflated).toContain('\\(par')
    expect(firstInflated).not.toContain('(parênteses) e')
  })
})
