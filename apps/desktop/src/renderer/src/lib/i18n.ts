/**
 * i18n (v0.12.1) — Brazing Portuguese (pt-BR) translation layer.
 *
 * Pattern: `t(locale, key)` returns the pt-BR string when the locale is
 * 'pt-BR' and a translation exists; English (the source) otherwise. The
 * dictionary covers the app shell, Hub, New Project modal and the most
 * common actions — extend it string by string as modules are touched.
 */
import { useCallback } from 'react'
import type { AppSettings } from '@mirai/shared'
import { useSettings } from './queries'

export type Locale = AppSettings['general']['locale']

const PT_BR: Record<string, string> = {
  // ------------------------------------------------------------- shell/nav
  'Project Hub': 'Central de Projetos',
  Settings: 'Configurações',
  Diagnostics: 'Diagnóstico',
  'Overview': 'Visão Geral',
  'Story Bible': 'Bíblia da História',
  'Style Bible': 'Bíblia Visual',
  Characters: 'Personagens',
  Locations: 'Locações',
  'Episodes & Scenes': 'Episódios & Cenas',
  Storyboard: 'Storyboard',
  Timeline: 'Linha do Tempo',
  'Render & Export': 'Render & Exportar',
  Production: 'Produção',
  Subtitles: 'Legendas',
  'AI Workflows': 'Fluxos de IA',
  'Producer Agent': 'Agente Produtor',
  Plugins: 'Plugins',
  'Media Library': 'Biblioteca de Mídia',
  'Prompt Library': 'Biblioteca de Prompts',
  'AI Assist': 'Assistente de IA',
  Jobs: 'Tarefas',
  Backups: 'Backups',
  'App': 'Aplicativo',
  'Command palette': 'Paleta de comandos',

  // ------------------------------------------------------------------- hub
  'Mirai Studio · Project Hub': 'Mirai Studio · Central de Projetos',
  'Your stories,': 'Suas histórias,',
  'ready to become anime.': 'prontas para virar anime.',
  'From story bible to export — characters, scenes, screenplay and a curated manga prompt library. Everything stays on your machine.':
    'Da bíblia da história ao export — personagens, cenas, roteiro e render. Tudo fica na sua máquina.',
  'Open Folder…': 'Abrir Pasta…',
  'New Project': 'Novo Projeto',
  'Inside every project': 'Dentro de cada projeto',
  '100% local-first': '100% local-first',
  'Your keys, your machine': 'Suas chaves, sua máquina',
  'Active productions': 'Produções ativas',
  'Archived': 'Arquivados',
  'No productions yet': 'Nenhuma produção ainda',
  'Create your first project': 'Criar meu primeiro projeto',
  '● Active': '● Ativo',
  'No description': 'Sem descrição',

  // --------------------------------------------------------- new project
  'Project name': 'Nome do projeto',
  'Project description (optional)': 'Descrição do projeto (opcional)',
  'Project folder': 'Pasta do projeto',
  'Work title': 'Título da obra',
  'Genre (free text)': 'Gênero (texto livre)',
  'Anime genres': 'Gêneros de anime',
  'Language': 'Idioma',
  'Aspect ratio': 'Proporção',
  'FPS': 'FPS',
  'Content rating': 'Classificação de conteúdo',
  '18+ — adult content enabled for this production': '18+ — conteúdo adulto habilitado para esta produção',
  'All ages': 'Todas as idades',
  '18+ — adults only (Mature Mode)': '18+ — somente adultos (Mature Mode)',
  'Planned episodes': 'Episódios planejados',
  'Create Project': 'Criar Projeto',
  'Choose folder…': 'Escolher pasta…',

  // ------------------------------------------------------------- settings
  'General': 'Geral',
  'Interface language': 'Idioma da interface',
  'Autosave interval (ms)': 'Intervalo de autosave (ms)',
  'Interface density': 'Densidade da interface',
  'Comfortable': 'Confortável',
  'Compact (smaller text & spacing)': 'Compacta (texto e espaçamento menores)',
  'UI scale': 'Escala da interface',
  '85% — small screens': '85% — telas pequenas',
  '100% — default': '100% — padrão',
  '110%': '110%',
  '125% — large screens': '125% — telas grandes',
  '140% — reading comfort': '140% — conforto de leitura',
  'Auto-fit small screens': 'Auto-ajuste para telas pequenas',
  'The interface shrinks itself automatically on short windows — recommended ON. Uncheck if you prefer the fixed scale above.':
    'A interface encolhe sozinha em janelas baixas — recomendado LIGADO. Desligue se prefere a escala fixa acima.',
  'ON': 'LIGADO',
  'OFF': 'DESLIGADO',
  'Confirm destructive actions': 'Confirmar ações destrutivas',
  'Ask before anything irreversible.': 'Perguntar antes de qualquer coisa irreversível.',
  'Save Settings': 'Salvar Configurações',
  'Settings saved': 'Configurações salvas',

  // np extras
  'Episodes': 'Episódios',
  'Description': 'Descrição',
  'Location': 'Local',
  'Template': 'Modelo',
  'Resolution': 'Resolução',

  // --------------------------------------------- seasons + demographic (v0.19)
  'Seasons planned for the IP': 'Temporadas planejadas para a IP',
  'e.g. 2 · 4 — how many seasons/arcs the whole IP plans': 'ex.: 2 · 4 — quantas temporadas/arcos a IP completa planeja',
  'A temporada 1 fecha seu arco e semeia o grande arco da IP.': 'A temporada 1 fecha seu próprio arco e semeia o grande arco da IP.',
  'Demographic': 'Demografia',
  'all fields optional': 'todos os campos opcionais',
  'seasons': 'temporadas',

  // --------------------------------------------- brief + adaptation (v0.18)
  'Author brief — optional, powers the AI': 'Brief do autor — opcional, turbinam a IA',
  'Target audience': 'Público-alvo',
  'e.g. shounen 14-19 · seinen adults · josei 25+': 'ex.: shounen 14-19 · seinen adultos · josei 25+',
  'References & inspirations': 'Referências e inspirações',
  'e.g. Mushishi x Violet Evergarden': 'ex.: Mushishi x Violet Evergarden',
  'World & era': 'Mundo e época',
  'e.g. Taishō-era Kyoto with spirit telegraphy': 'ex.: Quioto da era Taishō com telégrafo espiritual',
  'Ending vision': 'Visão de desfecho',
  'Where the story lands — the ending you are building toward': 'Onde a história pousa — o desfecho para o qual você está construindo',
  'Pages per chapter': 'Páginas por capítulo',
  'Minutes per episode': 'Minutos por episódio',
  'brief-hint': 'Estas respostas alimentam TODAS as gerações da IA (Bíblia, elenco, episódios, roteiros, dossiê) — quanto mais completas, mais fiel e comercial a sua IP sai. A IA prioriza SEMPRE o documento que você importar.',
  'Building the story from your document': 'Montando a história do seu documento',
  'adapt-queued': 'A adaptação roda como tarefa — siga o progresso em Jobs. Bíblia, elenco, temporada e roteiros serão criados a partir do SEU documento.',
  'Your document is ready to become a story': 'Seu documento está pronto para virar história',
  'adapt-card-desc': 'A IA vai extrair a história do seu arquivo — Bíblia da História, personagens, plano da temporada completa e roteiros do episódio 1 — com fidelidade ao documento (ele é o cânon).',
  'Build the story from the document': 'Montar a história do documento',
  'Adaptation failed': 'Falha na adaptação',

  // ------------------------------------------------------- themes (v0.17)
  'Theme': 'Tema',
  'Custom accent color': 'Cor de destaque personalizada',
  'Pick the accent color of your studio.': 'Escolha a cor de destaque do seu estúdio.',

  // ---------------------------------------------- notes import + dossier (v0.15)
  'Import story notes…': 'Importar notas da história…',
  'Analyze with AI': 'Analisar com IA',
  'Google Docs exports included': 'exportações do Google Docs inclusas',
  'Imported': 'Importados',
  'files': 'arquivos',
  'characters': 'caracteres',
  'truncated': 'truncado',
  'Notes imported': 'Notas importadas',
  'Import failed': 'Falha na importação',
  'Analysis failed': 'Falha na análise',
  'Notes analyzed': 'Notas analisadas',
  'AI professional analysis': 'Análise profissional por IA',
  'Suggested': 'Sugerido',
  'episodes': 'episódios',
  'Improvements': 'Melhorias',
  'Risks': 'Riscos',
  'Commercial notes': 'Notas comerciais',
  'Apply to form': 'Aplicar ao formulário',
  'Medium': 'Matéria/Formato',
  'Choose…': 'Escolher…',
  'Anime (animated series/film)': 'Anime (série/filme animado)',
  'Mangá (printed/digital comic)': 'Mangá (quadrinhos impresso/digital)',
  'Light Novel': 'Light Novel',
  'Novel (prose fiction)': 'Romance (ficção em prosa)',
  'Webtoon (vertical scroll comic)': 'Webtoon (quadrinho de rolagem vertical)',
  'Other audiovisual/literary work': 'Outra obra audiovisual/literária',
  'Project Dossier': 'Dossiê do Projeto',
  'dossier-desc': 'Documento comercial-profissional completo da obra: ficha técnica (título, matéria, episódios, versão), Bíblias, elenco, plano de episódios, status de produção, estratégia comercial e fundamentos jurídicos (advocacia). Gera .txt e .pdf A4 de 30-45+ páginas.',
  'Last dossier': 'Último dossiê',
  'pages': 'páginas',
  'AI-enriched': 'enriquecido por IA',
  'data sections only': 'somente seções de dados',
  'Dossier queued': 'Dossiê na fila',
  'dossier-queued-desc': 'A geração roda como tarefa — acompanhe em Jobs. O PDF e o TXT caem em exports/dossier/ do projeto.',
  'Dossier failed': 'Falha no dossiê',

  // ------------------------------------------------------------- actions
  'Cancel': 'Cancelar',
  'Delete': 'Excluir',
  'Close': 'Fechar',
  'Retry': 'Tentar novamente',
  'Create': 'Criar',
  'Open Project': 'Abrir Projeto',
  'Duplicate': 'Duplicar',
  'Back Up Now': 'Fazer Backup Agora',
  'Reveal in Folder': 'Mostrar na Pasta',
  'Archive': 'Arquivar',
  'Restore from Archive': 'Restaurar do Arquivo',
  'Remove from List…': 'Remover da Lista…',
  // ------------------------------------------------------- manga studio (v0.22)
  'Manga Studio': 'Estúdio de Mangá',
  'Manga & Animatic': 'Mangá & Animático',
  'Production & Delivery': 'Produção & Entrega',
  'AI & Library': 'IA & Biblioteca',
  'Moodboard': 'Moodboard',
  'Add reference': 'Adicionar referência',
  'Color script': 'Color script',
  'Swatch': 'Cor',
  'Poster Studio': 'Estúdio de Pôster',
  'Export poster': 'Exportar pôster',
  'Tagline': 'Tagline',
  'AI: 3 taglines': 'IA: 3 taglines',
  'AI candidates — pick one': 'Candidatas da IA — escolha uma',
  'Pages': 'Páginas',
  'Page': 'Página',
  'New page': 'Nova página',
  'Add panel': 'Adicionar quadrinho',
  'Add bubble': 'Adicionar balão',
  'Save panel': 'Salvar quadrinho',
  'Panel art': 'Arte do quadrinho',
  'Script': 'Roteiro',
  'Proofs': 'Provas',
  'AI lettering': 'Lettering IA',
  'Save': 'Salvar',
}
/** Translate: pt-BR when translated, English source otherwise. */
export function t(locale: Locale, key: string): string {
  if (locale === 'pt-BR') return PT_BR[key] ?? key
  return key
}

/** Curried helper: `const tr = useT(locale)` then `tr('nav.hub')`. */
export function makeT(locale: Locale) {
  return (key: string) => t(locale, key)
}

/**
 * React hook: `const tr = useT()` — resolves the active locale from settings.
 * Components stay declarative; new keys fall back to English automatically.
 */
export function useT(): (key: string) => string {
  const { data: settings } = useSettings()
  const locale = settings?.general.locale ?? 'en'
  return useCallback((key: string) => t(locale, key), [locale])
}
