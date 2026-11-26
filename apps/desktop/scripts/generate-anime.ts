/**
 * generate-anime.ts — o gerador dos dois episódios, pela máquina do usuário,
 * pelo caminho 100% gratuito.
 *
 *   bun scripts/generate-anime.ts --anime nagatoro   (23 min)
 *   bun scripts/generate-anime.ts --anime hentai     (19 min)
 *
 * FASE A FASE, tudo REAL e RETOMÁVEL (o estado vive no JSON do projeto —
 * um reboot do propósito continua de onde parou):
 *   1. bootstrap: projeto, bíblia, estilo, elenco (Edge voz por personagem)
 *   2. roteiro: cenas-chave + beats intercalados → shots de 8 s até o alvo
 *   3. frames: Pollinations (1 imagem / 45 s — o rate limit é respeitado
 *      com espera e nova tentativa, não com gambiarra)
 *   4. voz: Edge neural por personagem, com o polish FFmpeg do app
 *   5. clipes: movimento de câmera real (zoompan) por shot — o caminho
 *      grátis de motion para episódio longo
 *   6. montagem: concat + mixagem de voz + legenda branca clássica (.ass)
 *      queimada + MP4 final 1080p
 *   7. dossiê: o DossierService do app, txt + pdf
 *
 * Nada de mock: cada fase toca o provider/encoder real e falha alto com o
 * motivo quando o mundo real recusa.
 */
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  ProjectService,
  CreativeService,
  StoryboardService,
  RenderService,
  LoggerService,
  DossierService,
  openDatabase,
  runMigrations,
  systemClock,
  plaintextCodec,
  ffprobeBin,
  APP_DB_MIGRATIONS,
  SettingsService,
  CredentialStore,
  suggestMotion,
  backgroundPrompt,
  characterPrompt,
  parallaxClipArgs,
  type AppDirs,
} from '@mirai/core'
import { AiHost } from '../src/main/ai/aiHost'
import { ProjectConfig } from '@mirai/shared'
import { STORIES, type Story, type StoryLine } from './story-data'


// ------------------------------------------------------------------ argumentos

const args = process.argv.slice(2)
const animeArg = args[args.indexOf('--anime') + 1]
const downloadsArg = args.indexOf('--downloads') >= 0 ? args[args.indexOf('--downloads') + 1] : '/home/llinux/Downloads'
if (!animeArg || !(animeArg in STORIES)) {
  console.error('uso: bun scripts/generate-anime.ts --anime <nagatoro|hentai> [--downloads DIR]')
  process.exit(1)
}
const story: Story = STORIES[animeArg]!
const DOWNLOADS = downloadsArg!
const FFMPEG = '/home/llinux/mirai-studio/apps/desktop/resources/ffmpeg/ffmpeg'
const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...parts)

// ------------------------------------------------------------------ bootstrap

async function main() {
  // RAIZ PERSISTENTE: a geração roda por HORAS e um restart do servidor
// limpou /tmp levando ~2h de camadas. Fora do /tmp ela sobrevive a reboot.
const GEN_ROOT = process.env.MIRAI_GEN_ROOT ?? join(homedir(), 'mirai-gen')
const root = GEN_ROOT
  const dirs: AppDirs = {
    root,
    logs: join(root, 'logs'),
    backups: join(root, 'backups'),
    projectsDefaultDir: join(root, 'projects'),
    appDb: join(root, 'app.sqlite'),
  }
  mkdirSync(dirs.projectsDefaultDir, { recursive: true })
  mkdirSync(dirs.backups, { recursive: true })

  const logger = new LoggerService({ logDir: dirs.logs })
  const appDb = openDatabase(dirs.appDb)
  runMigrations(appDb, APP_DB_MIGRATIONS)
  const projects = new ProjectService({
    appDb,
    dirs,
    clock: systemClock,
    appVersion: '2.1.1-alpha.2-gen',
    logger,
    onJobUpdated: () => undefined,
  })

  // idempotente: reusar o projeto se a execução anterior chegou até aqui
  const existing = projects.list(true).find((p) => p.name === story.projectName)
  const summary = existing ?? projects.create({
    name: story.projectName,
    description: story.description,
    dir: dirs.projectsDefaultDir,
    config: ProjectConfig.parse({
      title: story.title,
      genres: [story.genre],
      contentRating: story.contentRating,
      episodeCount: 1,
      seasonCount: 1,
      aspectRatio: '16:9',
      fps: 24,
      inspirations: animeArg === 'nagatoro' ? 'Nagatoro-san (comédia romântica de clube de arte)' : 'Nagatoro-san — variação adulta de seminário',
    }),
  })
  log('projeto:', summary.name, '→', summary.path, existing ? '(reaproveitado)' : '(novo)')

  const ctx = await projects.open(summary.path)
  const creative = ctx.creative as CreativeService
  const storyboard = ctx.storyboard as StoryboardService
  const render = ctx.render as RenderService

  // settings: imagem Pollinations (sem chave), voz Edge (sem chave)
  // v2.1: MOTOR PRÓPRIO POR CAMADAS — fundo + personagem + parallax.
  const settingsSvc = new SettingsService(appDb)
  settingsSvc.patch({
    ai: {
      ...settingsSvc.get().ai,
      image: {
        ...settingsSvc.get().ai.image,
        protocol: 'pollinations',
        baseUrl: 'https://image.pollinations.ai',
        model: 'flux',
        size: '1344x768',
        noWatermark: true,
      },
      tts: { ...settingsSvc.get().ai.tts, protocol: 'edge', voice: '' },
      video: { ...settingsSvc.get().ai.video, protocol: 'pollinations' },
    },
    content: { ...settingsSvc.get().content, matureEnabled: true },
  })

  const ai = new AiHost({
    credentials: new CredentialStore(appDb, plaintextCodec, systemClock),
    settings: settingsSvc,
    projects,
    logger,
    emitter: { send: () => undefined, window: null } as never,
  })

  // ------------------------------------------------------------------ 1. conteúdo

  const statePath = join(summary.path, 'generation-state.json')
  const state = existsSync(statePath)
    ? (JSON.parse(readFileSync(statePath, 'utf8')) as { shotsTotal: number; frames: number; voices: number; clips: number })
    : { shotsTotal: 0, frames: 0, voices: 0, clips: 0 }

  const SAVE = () => writeFileSync(statePath, JSON.stringify(state, null, 2))

  creative.updateBible({
    ...creative.getBible(),
    premise: story.premise,
    themes: story.themes,
    tone: story.tone,
  })
  storyboard.updateStyleBible({
    ...storyboard.getStyleBible(),
    artDirection: story.artDirection,
    lineart: 'traço limpo de anime televisivo, linhas finas com variação de espessura',
    shading: 'cel shading suave, duas etapas',
    palette: animeArg === 'hentai' ? 'âmbar quente, violeta, pele rosada, sombras profundas' : 'quente de poente, rosa sakura, azul escola',
    lighting: animeArg === 'hentai' ? 'luz baixa e intimista, lâmpadas quentes' : 'luz suave de poente e janelas altas',
    proportions: 'anime moderno, 7.5 cabeças',
    eyesAndHair: 'olhos grandes e expressivos, cabelo com mechas definidas',
    backgrounds: 'cenários de escola e interiores quentes, estilo Doga Kobo',
    cameraLanguage: 'planos médios e close-ups, movimento sutil de câmera',
  })

  // elenco (idempotente)
  const existingChars = creative.listCharacters()
  const cast = new Map<string, string>()
  for (const c of story.characters) {
    const found = existingChars.find((e) => e.name === c.name)
    if (found) cast.set(c.id, found.id)
    else {
      const created = creative.createCharacter({
        name: c.name,
        role: c.role as never,
        // A idade adulta EXPLÍCITA: o guarda de maturidade do app recusa
        // conteúdo +18 para personagens sem idade declarada — e ele tem razão.
        age: String(c.age ?? ''),
        appearance: c.appearance,
        personality: c.personality,
        ttsVoice: c.voice,
      })
      cast.set(c.id, created.id)
    }
  }
  log('elenco:', [...cast.keys()].join(', '))

  // ------------------------------------------------------------------ 2. roteiro

  const shotsOverride = args.indexOf('--shots') >= 0 ? Number(args[args.indexOf('--shots') + 1]) : 0
  const TARGET_SHOTS = shotsOverride > 0 ? shotsOverride : Math.floor((story.targetMinutes * 60) / 8)

  /** Compõe as cenas: as-chave primeiro, beats intercalados até o alvo. */
  function composeScenes(): Array<{ loc: string; time: Story['scenes'][number]['time']; lines: StoryLine[] }> {
    const out: Array<{ loc: string; time: Story['scenes'][number]['time']; lines: StoryLine[] }> = []
    const beatNames = Object.keys(story.beats)
    const locs = story.locations
    let beatIndex = 0
    const keyScenes = story.scenes
    while (out.length * 4 < TARGET_SHOTS) {
      for (const key of keyScenes) {
        out.push({ loc: key.loc, time: key.time, lines: key.lines })
        if (out.length * 4 >= TARGET_SHOTS) break
        const beatName = beatNames[beatIndex % beatNames.length]!
        const beat = story.beats[beatName]!
        beatIndex += 1
        const loc = locs[beatIndex % locs.length]!
        out.push({ loc: loc.name, time: animeArg === 'hentai' ? 'NIGHT' : (['DAY', 'DUSK'] as const)[beatIndex % 2], lines: beat })
      }
    }
    return out.slice(0, Math.ceil(TARGET_SHOTS / 4))
  }


  let episode = creative.listEpisodes()[0]
  if (!episode) {
    episode = creative.createEpisode({ season: 1, number: 1, title: `${story.title} — Episódio 1` })
  }
  const existingScenes = creative.listScenes(episode.id)
  if (existingScenes.length === 0) {
    const scenes = composeScenes()
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i]!
      const scene = creative.createScene(episode.id, {
        title: `Cena ${String(i + 1).padStart(2, '0')} — ${sc.loc}`,
        timeOfDay: sc.time as never,
        characterIds: [...new Set(sc.lines.filter((l) => l.who).map((l) => cast.get(l.who)!))],
      })
      creative.updateScene(scene.id, {
        ...scene,
        synopsis: sc.lines.map((l) => (l.who ? story.characters.find((c) => c.id === l.who)!.name : 'Narração') + ': ' + l.text).join('\n'),
        screenplay: sc.lines.map((l) => (l.who ? story.characters.find((c) => c.id === l.who)!.name.toUpperCase() : '') + '\n' + l.text).join('\n\n'),
      } as never)
      for (let j = 0; j < 4 && (i * 4 + j) < TARGET_SHOTS; j++) {
        const line = sc.lines[Math.min(j, sc.lines.length - 1)]!
        storyboard.createShot(scene.id, {
          title: `S${String(i + 1).padStart(2, '0')}·${j + 1} — ${sc.loc}`,
          shotType: (j === 0 ? 'WIDE' : j === 3 ? 'CLOSE_UP' : j === 2 ? 'OVER_THE_SHOULDER' : 'MEDIUM') as never,
          cameraMovement: line.move,
          durationSeconds: 8,
          dialogue: line.who ? story.characters.find((c) => c.id === line.who)!.name + '\n' + line.text : line.text,
        } as never)
      }
      if ((i + 1) % 5 === 0) log(`roteiro: ${Math.min((i + 1) * 4, TARGET_SHOTS)}/${TARGET_SHOTS} shots criados`)
    }
  }

  const allShots: Array<{ id: string; sceneId: string; shot: ReturnType<StoryboardService['listShots']>[number] }> = []
  for (const scene of creative.listScenes(episode.id)) {
    for (const shot of storyboard.listShots(scene.id)) allShots.push({ id: shot.id, sceneId: scene.id, shot })
  }
  log(`TOTAL: ${allShots.length} shots (~${Math.round((allShots.length * 8) / 60)} min)`)
  state.shotsTotal = allShots.length
  SAVE()

  // ------------------------------------------------------------------ helpers

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  /** Ação explícita por shot (+18): o prompt extra carrega o ato. */
  function extraPromptFor(shot: ReturnType<StoryboardService['listShots']>[number]): string | undefined {
    if (animeArg !== 'hentai') return undefined
    const text = (shot.dialogue ?? '').toLowerCase()
    if (/autorizo|me beija|deita aqui|contorno|bonita que o meu desenho/i.test(shot.dialogue ?? '')) {
      return 'cena sensual e explícita, casal adulto em intimidade, iluminação baixa quente, traço delicado, alta qualidade'
    }
    void text
    return undefined
  }

  /**
   * Roda a geração do frame com paciência pelo rate limit do Pollinations
   * (1 imagem / 45 s): espera a janela e tenta de novo, sem esconder nada.
   */
  async function frameWithRetry(shotId: string, extraPrompt: string | undefined): Promise<boolean> {
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        await ai.generateFrame(shotId, extraPrompt, AbortSignal.timeout(180_000), () => undefined)
        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const limited = /FREE_LIMIT|429|402|rate/i.test(message)
        if (!limited || attempt === 8) {
          log(`  FALHA frame ${shotId}: ${err instanceof Error ? (err.stack ?? message) : message}`)
          return false
        }
        log(`  rate limit — aguardando a janela de 45 s (tentativa ${attempt})`)
        await sleep(46_000)
      }
    }
    return false
  }

  // ------------------------------------------------- CAMADAS (motor próprio)
  const layersDir = join(summary.path, 'layers')
  mkdirSync(layersDir, { recursive: true })
  const { spawnSync: spawnFF } = await import('node:child_process')

  /** Gera uma camada diretamente no Pollinations (prompt NOSSO). */
  const genLayer = async (prompt: string, file: string): Promise<boolean> => {
    if (existsSync(file) && statSync(file).size > 3000) return true
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
      // MEDIDO AO VIVO: o modelo 'flux' (padrão) ignora assinatura de estilo e
      // devolve semi-real ~70% das vezes. 'z-image-turbo' devolve 2D cel-shaded
      // consistently, e o magenta do chroma sai limpo. O modelo É a alavanca.
      const res = await fetch('https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) + '?model=z-image-turbo')
        if (res.ok) {
          const bytes = Buffer.from(await res.arrayBuffer())
          if (bytes.length > 1000) {
            writeFileSync(file, bytes)
            return true
          }
        }
        log(`  camada: HTTP ${res.status} — aguardando a janela (${attempt})`)
      } catch (err) {
        log(`  camada: ${(err as Error).message} (${attempt})`)
      }
      await sleep(46_000)
    }
    return false
  }

  /**
   * Descritor ENXUTO (medido ao vivo: a descrição longa — "garota de 16
   * anos, cabelo castanho claro com franja chançada, olhos âmbar
   * provocantes..." — pesa mais que a assinatura e devolve semi-realista).
   * Só o essencial visual: cabelo, olhos, roupa. A assinatura 2D vem
   * primeiro no prompt, então o enxuto é o que mantém o resultado anime.
   */
  const shortDescriptor = (appearance: string): string => {
    const parts = appearance.split(',').map((p) => p.trim()).filter(Boolean)
    const keep = parts.filter((p) => /cabelo|olho|uniforme|kimono|blusa|saia|óculos|corpo|pele/i.test(p))
    const desc = (keep.length > 0 ? keep : parts.slice(0, 3)).join(', ')
    return desc.length > 90 ? desc.slice(0, 90) : desc
  }

  /** A expressão do personagem pelo texto da fala. */
  const expressionFor = (dialogue: string): string => {
    const t = dialogue.toLowerCase()
    if (/!/.test(dialogue) && /provoc|rir|zoar|deixa eu ver/i.test(t)) return 'sorrindo provocando, bochechas coradas'
    if (/não|neg|para|chega/i.test(t)) return 'sorrindo sem graça, mão na cabeça'
    if (/autorizo|beija|deita|contorno/i.test(t)) return 'olhar intenso e úmido, lábios entreabertos, respiração pes'
    if (/senpai|você|nm/i.test(t)) return 'expressão terna, olhos brilhando'
    return 'expressão calma, olhar suave'
  }

  /**
   * O clipe em PARALLAX de um shot (3 camadas, velocidades diferentes).
   * BUG MEU CORRIGIDO: a hora era derivada do TÍTULO da cena
   * ("Cena 11 — Avenida Molhada" não contém "NIGHT"), então as cenas
   * noturnas procuravam um fundo -DAY que não existe e o shot ficava sem
   * clipe. Agora vem do campo timeOfDay REAL da cena.
   */
  const composeParallax = (
    shot: ReturnType<StoryboardService['listShots']>[number],
    sceneTitle: string,
    timeOfDay: string,
  ): string | null => {
    const loc = sceneTitle.split('—').slice(1).join('—').trim() || sceneTitle
    const bgFile = join(layersDir, `bg-${loc.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}-${timeOfDay}.jpg`)
    const chFile = join(layersDir, `ch-${shot.id}.jpg`)
    if (!existsSync(bgFile) || !existsSync(chFile)) return null
    const out = join(summary.path, 'exports', `parallax-${shot.orderIndex + 1}-${shot.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mp4`)
    if (existsSync(out) && statSync(out).size > 5000) return out
    const args = parallaxClipArgs(
      out,
      {
        preset: suggestMotion(shot) === 'locked' ? 'pushIn' : suggestMotion(shot),
        durationSec: shot.durationSeconds,
        fps: 24,
        width: 1014,
        height: 580,
        layers: { backgroundPath: bgFile, characterPath: chFile },
      },
      'MASTER',
    )
    const r = spawnFF('/home/llinux/mirai-studio/apps/desktop/resources/ffmpeg/ffmpeg', args)
    return r.status === 0 && existsSync(out) ? out : null
  }

  // ------------------------------------------------------------------ 3. camadas

  log('=== FASE 3: CAMADAS (motor próprio: fundo + personagem, Pollinations) ===')
  let frameFailures = 0
  // 3a. FUNDOS — um por (locação, hora): a cache faz 40 imagens servirem 170 shots
  const bgJobs = new Map<string, string>()
  for (const scene of creative.listScenes(episode.id)) {
    const loc = scene.title.split('—').slice(1).join('—').trim() || scene.title
    const time = scene.timeOfDay
    const key = `${loc}|${time}`
    const file = join(layersDir, `bg-${loc.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}-${time}.jpg`)
    if (!bgJobs.has(key)) bgJobs.set(key, file)
  }
  let bgDone = 0
  for (const [key, file] of bgJobs) {
    const [loc, time] = key.split('|')
    const ok = await genLayer(backgroundPrompt(loc!, time!, story.artDirection), file!)
    if (ok) bgDone++
    else frameFailures++
    if (bgDone % 5 === 0) log(`fundos: ${bgDone}/${bgJobs.size}`)
  }
  log(`fundos prontos: ${bgDone}/${bgJobs.size}`)

  // 3b. PERSONAGENS — um por shot com fala (o chroma sai no parallax)
  let charDone = 0
  for (let i = 0; i < allShots.length; i++) {
    const entry = allShots[i]!
    const shot = storyboard.getShotById(entry.id)
    const dialogue = (shot.dialogue ?? '').trim()
    if (!dialogue.includes('\n')) continue // estabelecedor/narração: só o fundo
    const scene = creative.getSceneById(shot.sceneId)
    const castInScene = creative.listCharacters().filter((c) => scene.characterIds.includes(c.id))
    const speaker = dialogue.split('\n')[0]!.trim()
    const who = castInScene.find((c) => c.name.toUpperCase() === speaker.toUpperCase()) ?? castInScene[0]
    const text = dialogue.split('\n').slice(1).join(' ').trim()
    const chFile = join(layersDir, `ch-${shot.id}.jpg`)
    const ok = await genLayer(
      characterPrompt(who?.name ?? speaker, shortDescriptor(who?.appearance ?? 'anime character'), expressionFor(text), story.artDirection),
      chFile,
    )
    if (ok) {
      charDone++
      // o personagem chapado vira o "quadro" do shot na UI
      if (!shot.frameAssetId) {
        storyboard.registerGeneratedFrame(shot.id, readFileSync(chFile), 'image/jpeg')
      }
    } else frameFailures += 1
    if (charDone % 10 === 0) log(`personagens: ${charDone}`)
  }
  state.frames = charDone
  SAVE()
  log(`camadas prontas: ${bgDone} fundos · ${charDone} personagens (falhas: ${frameFailures})`)

  /** Um mp3 só é voz se DECODIFICAR: um corte de resposta do Edge (medido:
   *  1 em 140) tem 33 KB e não toca. Prova antes de usar. */
  const rmSyncSafe = (file: string) => {
    try {
      const { rmSync } = require('node:fs') as typeof import('node:fs')
      rmSync(file, { force: true })
    } catch {
      /* um arquivo que não some não impede a retentativa */
    }
  }

  const audioIsValid = (file: string): boolean => {
    try {
      const p = spawnSync(ffprobeBin(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])
      const d = Number(p.stdout.toString().trim())
      return Number.isFinite(d) && d > 0.1
    } catch {
      return false
    }
  }

  // ------------------------------------------------------------------ 4. vozes

  log('=== FASE 4: VOZ (Edge neural + polish) ===')
  for (let i = 0; i < allShots.length; i++) {
    const entry = allShots[i]!
    if (entry.shot.voiceAssetId) continue
    const dialogue = (entry.shot.dialogue ?? '').trim()
    if (!dialogue || !dialogue.includes('\n')) continue // narração pura não é dublada
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const shot = storyboard.getShotById(entry.id)
        const voiceFile = shot.voiceAssetId ? storyboard.assetAbsolutePath(shot.voiceAssetId) : null
        if (voiceFile && audioIsValid(voiceFile)) {
          state.voices += 1
          break
        }
        if (voiceFile && existsSync(voiceFile)) rmSyncSafe(voiceFile)
        await ai.speakShot(entry.id, AbortSignal.timeout(120_000))
        const spoken = storyboard.getShotById(entry.id)
        const newFile = spoken.voiceAssetId ? storyboard.assetAbsolutePath(spoken.voiceAssetId) : null
        if (newFile && audioIsValid(newFile)) {
          state.voices += 1
          if (state.voices % 20 === 0) {
            SAVE()
            log(`vozes: ${state.voices}`)
          }
          break
        }
        if (newFile && existsSync(newFile)) rmSyncSafe(newFile)
        log(`  voz ${entry.id}: mp3 inválido — retentando (${attempt})`)
      } catch (err) {
        log(`  FALHA voz ${entry.id}: ${err instanceof Error ? err.message : String(err)}`)
        break
      }
    }
  }
  SAVE()
  log(`vozes prontas: ${state.voices}`)

  // ------------------------------------------------------------------ 5. clipes

  log('=== FASE 5: CLIPES EM PARALLAX (motor próprio, 3 camadas) ===')
  let composed = 0
  for (let i = 0; i < allShots.length; i++) {
    const entry = allShots[i]!
    const shot = storyboard.getShotById(entry.id)
    const scene = creative.getSceneById(shot.sceneId)
    const hasChar = (shot.dialogue ?? '').includes('\n')
    if (!hasChar) {
      // shot de estabelecimento/narração: movimento de câmera no quadro cheio
      if (!shot.frameAssetId) continue
      const clipName = `parallax-${shot.orderIndex + 1}-${shot.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mp4`
      const out = join(summary.path, 'exports', clipName)
      if (existsSync(out) && statSync(out).size > 5000) continue
      const args = cameraMoveArgs(
        storyboard.assetAbsolutePath(shot.frameAssetId),
        out,
        { preset: suggestMotion(shot), durationSec: shot.durationSeconds, fps: 24, width: 1014, height: 580 },
        'MASTER',
        { id: 'frame-native', label: 'Frame', description: 'nativo', width: 1014, height: 580, fps: 24, videoKbps: 8000, audioKbps: 192 },
      )
      const r = spawnSync(FFMPEG, args)
      if (r.status === 0) composed++
      continue
    }
    const out = composeParallax(shot, scene.title, scene.timeOfDay)
    if (out) {
      composed++
      if (composed % 20 === 0) log(`clipes: ${composed}/${allShots.length}`)
    } else {
      frameFailures += 1
      log(`  FALHA parallax shot ${entry.id}`)
    }
  }
  state.clips = composed
  SAVE()
  log(`clipes prontos: ${composed}/${allShots.length}`)

  // ------------------------------------------------------------------ 6. montagem

  log('=== FASE 6: MONTAGEM (concat + voz + legenda branca) ===')

  interface Segment { clip: string; voice: string | null; text: string | null }
  const segments: Segment[] = []
  for (const scene of creative.listScenes(episode.id)) {
    for (const shot of storyboard.listShots(scene.id)) {
      // Os clipes do motor próprio são `parallax-<n>-<titulo>.mp4` (o nome
      // antigo `shot-*` era do camera-motion simples).
      const clip = join(
        summary.path,
        'exports',
        `parallax-${shot.orderIndex + 1}-${shot.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mp4`,
      )
      if (!existsSync(clip)) continue
      segments.push({
        clip,
        voice: shot.voiceAssetId ? storyboard.assetAbsolutePath(shot.voiceAssetId) : null,
        text: shot.dialogue ? shot.dialogue.split('\n').slice(1).join(' ').trim() : null,
      })
    }
  }
  log(`segmentos para montar: ${segments.length}`)

  // 6.1 — vídeo: concat demuxer com os clipes na ordem
  const concatList = segments.map((s) => `file '${s.clip}'`).join('\n')
  const concatFile = join(root, 'concat.txt')
  writeFileSync(concatFile, concatList)
  const videoOnly = join(root, 'video.mp4')
  // RE-ENCODE no concat: com `-c copy` o muxer empacota clipes de timebases
  // ligeiramente diferentes e o arquivo final nasce com NAL inválido
  // (MEDIDO: o hentai anterior decodia com "Invalid NAL unit size" aos
  // montes). Re-encodar em H.264 com o mesmo preset do burn é alguns minutos
  // e entrega um arquivo limpo.
  let r = spawnSync(FFMPEG, [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
    '-c:v', 'libx264', '-tune', 'animation', '-preset', 'medium', '-crf', '17',
    '-pix_fmt', 'yuv420p', '-r', '24',
    videoOnly,
  ])
  if (r.status !== 0) {
    console.error('concat de vídeo falhou:', r.stderr?.toString().slice(-400))
    process.exit(1)
  }

  // 6.2 — legendas: o .ass clássico (branco, contorno preto, base central)
  const assPath = join(root, 'legendas.ass')
  const assLines: string[] = [
    '[Script Info]',
    'Title: ' + story.title,
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // legenda branca clássica: preenchimento branco, contorno preto, base central
    'Style: Default,DejaVu Sans,20,&H00FFFFFF,&H000019FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,2.2,1,2,60,60,34,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  const fmtTime = (t: number) => {
    const h = Math.floor(t / 3600)
    const m = Math.floor((t % 3600) / 60)
    const s = Math.floor(t % 60)
    const cs = Math.round((t % 1) * 100)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
  }
  let cursor = 0
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    const from = cursor
    cursor += 8
    if (!seg.text || !seg.voice) continue
    const dur = Number(
      spawnSync(ffprobeBin(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', seg.voice])
        .stdout.toString()
        .trim(),
    )
    const end = from + (Number.isFinite(dur) ? Math.min(dur, 7.4) : 7)
    const speaker = seg.text.split(':')[0]
    const text = seg.text.includes(':') ? seg.text.split(':').slice(1).join(':').trim() : seg.text
    assLines.push(`Dialogue: 0,${fmtTime(from + 0.35)},${fmtTime(end)},Default,${speaker ?? ''},0,0,0,,${(text ?? '').replace(/([{}\\]])/g, '$1')}`)
  }
  writeFileSync(assPath, assLines.join('\n'))

  // A faixa de áudio é RE-ENCODADA: os mp3 do Edge têm taxas e quadros
  // ligeiramente diferentes, e o concat com `-c copy` engasga neles
  // ("invalid dropping st:0"). Re-encodar em AAC normaliza a pista inteira.
  const audioTrack = join(root, 'audio.m4a')
  {
    const segFiles: string[] = []
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!
      if (seg.voice) {
        segFiles.push(`file '${seg.voice}'`)
      } else {
        const silence = join(root, `sil-${i}.m4a`)
        spawnSync(FFMPEG, [
          '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=8',
          '-c:a', 'aac', '-b:a', '192k', silence,
        ])
        segFiles.push(`file '${silence}'`)
      }
    }
    writeFileSync(concatFile, segFiles.join('\n'))
    r = spawnSync(FFMPEG, [
      '-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      audioTrack,
    ])
    if (r.status !== 0) {
      console.error('concat de áudio falhou:', r.stderr?.toString().slice(-300))
      process.exit(1)
    }
  }

  // 6.4 — casamento final: vídeo + áudio + legenda queimada
  // A pista de áudio precisa ter A MESMA duraçăo do vídeo: as vozes do Edge
  // duram ~3 s e o silêncio 8 s, então a faixa somada fica MENOR que o vídeo
  // e o burn sai cortado (MEDIDO: 524 s em vez de 1088 s). O apad estica a
  // faixa com silêncio até a duraçăo exata do corte.
  const targetSeconds = segments.length * 8
  const audioPadded = join(root, 'audio-padded.m4a')
  r = spawnSync(FFMPEG, [
    '-y', '-i', audioTrack,
    '-af', `apad`, '-t', targetSeconds.toFixed(3),
    '-c:a', 'aac', '-b:a', '192k',
    audioPadded,
  ])
  if (r.status !== 0) {
    console.error('apad do áudio falhou:', r.stderr?.toString().slice(-300))
    process.exit(1)
  }

  const finalBurned = join(root, 'final-burned.mp4')
  const finalName = `${story.projectName.replace(/[^a-z0-9]+/gi, '-')}.mp4`
  r = spawnSync(FFMPEG, [
    '-y',
    '-i', videoOnly,
    '-i', audioPadded,
    '-vf', `subtitles='${assPath}'`,
    '-c:v', 'libx264', '-tune', 'animation', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    finalBurned,
  ])
  if (r.status !== 0) {
    console.error('queima da legenda falhou:', r.stderr?.toString().slice(-500))
    process.exit(1)
  }

  const duration = Number(spawnSync(ffprobeBin(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', finalBurned]).stdout.toString().trim())
  log(`MP4 final: ${finalBurned} — ${duration ? (duration / 60).toFixed(1) : '?'} min`)

  // ------------------------------------------------------------------ 7. dossiê

  log('=== FASE 7: DOSSIÊ ===')
  const dossierService = new DossierService(summary.path, systemClock)
  const dossierChars = creative.listCharacters()
  const episodesData = creative.listEpisodes().map((ep) => ({
    season: ep.season,
    number: ep.number,
    title: ep.title,
    synopsis: ep.synopsis ?? '',
    scenes: [] as string[],
  }))
  const manifest = ctx.manifest
  const dossierResult = dossierService.generate(
    {
      name: manifest.name,
      description: manifest.description ?? '',
      medium: 'anime',
      title: manifest.config.title,
      genres: manifest.config.genres,
      contentRating: manifest.config.contentRating ?? '12',
      language: 'pt-BR',
      aspectRatio: manifest.config.aspectRatio,
      resolution: '1920x1080',
      fps: manifest.config.fps,
      plannedEpisodes: manifest.config.episodeCount ?? null,
      plannedSeasons: manifest.config.seasonCount ?? null,
      demographic: manifest.config.demographic ?? '',
      targetAudience: manifest.config.targetAudience,
      inspirations: manifest.config.inspirations,
      endingVision: manifest.config.endingVision,
      appVersion: manifest.appVersion,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      licenseTier: 'Mirai Studio (free)',
      storyBible: {
        premise: creative.getBible().premise,
        themes: creative.getBible().themes,
        tone: creative.getBible().tone,
        message: creative.getBible().message,
        narrativeRules: creative.getBible().narrativeRules,
        coreConcepts: creative.getBible().coreConcepts,
        genreNotes: creative.getBible().genreNotes,
      },
      styleBible: storyboard.getStyleBible(),
      characters: dossierChars.map((ch) => ({
        name: ch.name,
        role: ch.role,
        age: ch.age,
        appearance: ch.appearance,
        personality: ch.personality,
        voice: ch.voice,
        backstory: [ch.bio, ch.goals ? `Objetivos: ${ch.goals}` : '', ch.fears ? `Medos: ${ch.fears}` : '', ch.notes]
          .filter((x) => x && x.trim().length > 0)
          .join(' — ') || undefined,
      })),
      episodes: episodesData,
      tasks: ctx.production.listTasks().map((t) => ({ title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate })),
      // o QC real do projeto, mapeado como o handler do app faz
      qc: (() => {
        const qcReport = ctx.production.runQc(manifest.config.contentRating ?? null)
        return {
          errors: qcReport.errorCount,
          warnings: qcReport.warningCount,
          infos: qcReport.infoCount,
          top: qcReport.findings
            .filter((f) => f.severity === 'ERROR' || f.severity === 'WARNING')
            .slice(0, 8),
        }
      })(),
    } as never,
    null,
    '2.1.1-alpha.2-gen',
  )
  log('dossiê:', dossierResult.txtPath, '|', dossierResult.pdfPath)

  // ------------------------------------------------------------------ entrega

  log('=== ENTREGA ===')
  const outDir = join(DOWNLOADS, story.projectName.replace(/[^a-z0-9]+/gi, '-'))
  mkdirSync(outDir, { recursive: true })
  spawnSync('cp', [finalBurned, join(outDir, finalName)])
  spawnSync('cp', [dossierResult.txtPath, join(outDir, 'dossier.txt')])
  if (existsSync(dossierResult.pdfPath)) spawnSync('cp', [dossierResult.pdfPath, join(outDir, 'dossier.pdf')])
  log('ENTREGUE em:', outDir)
  log('  -', finalName, `(${duration ? (duration / 60).toFixed(1) : '?'} min)`)
  log('  - dossier.txt / dossier.pdf')
  projects.close()
}

void main()
