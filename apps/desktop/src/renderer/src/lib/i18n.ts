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
