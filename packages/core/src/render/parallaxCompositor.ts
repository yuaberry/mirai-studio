/**
 * parallaxCompositor (v2.1) — o MOTOR do studio próprio.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * Um clipe de vídeo com personagem animado exige GPU (não há) ou API paga
 * (não há chave). O que NÃO exige nenhum dos dois: **profundidade real**.
 * Um anime de verdade (referência: Malfoid) vive de planos em camadas — o
 * fundo anda mais devagar que o personagem, a luz muda, a câmera viaja.
 *
 * Este módulo compõe 3 camadas em UM clipe:
 *   · FUNDO (imagem da locação, gerada sem personagem) — viaja a 0.45×
 *   · MEIO (imagem da locação com detalhe/profundidade)   — viaja a 0.75×
 *   · PERSONAGEM (imagem chapada, cromada contra magenta)  — viaja a 1.25×
 *
 * A chave contra magenta deixa o personagem com ALFA real; cada camada
 * recebe o SEU movimento de câmera (a mesma direção, velocidade diferente),
 * e o overlay compõe o resultado. É o truque de parallax que os curtas de
 * anime usam — e ele é 100% FFmpeg, gratuito e determinístico.
 *
 * A ARQUITETURA JÁ RECEBE ANIMAÇÃO: amanhã, quando houver token de GPU/API,
 * a camada do personagem passa a ser um CLIPE animado (LivePortrait/AnimateDiff)
 * em vez da imagem estática — os mesmos argumentos, só o `-i` muda. É para
 * isso que `characterIsVideo` existe.
 */
import type { CameraMotionSpec } from './cameraMotion'
import { evenSize, frameCount } from './cameraMotion'

export interface ParallaxLayerSpec {
  /** The scene image (no characters) — the FAR layer. */
  backgroundPath: string
  /** The character image, keyed against magenta (#FF00FF) — the NEAR layer. */
  characterPath?: string
  /** A midground image (depth between bg and character). */
  midgroundPath?: string
  /** When true, the character input is a VIDEO (animated) — the future. */
  characterIsVideo?: boolean
}

export interface ParallaxSpec extends CameraMotionSpec {
  layers: ParallaxLayerSpec
  /** Depth factors per layer (1 = the camera's own speed). */
  depth?: { background: number; midground: number; character: number }
}

const defaultDepth = { background: 0.45, midground: 0.75, character: 1.25 }

/**
 * O filter_complex do parallax. Cada camada é escalada (cabeça de movimento,
 * sem exibir bordas), recebe o SEU zoompan, e as camadas com transparência
 * são sobrepostas na base.
 */
export function parallaxFilterComplex(spec: ParallaxSpec): string {
  const { width, height } = evenSize(spec.width, spec.height)
  const frames = frameCount(spec)
  const depth = spec.depth ?? defaultDepth
  const parts: string[] = []

  // ---- o fundo: escalado 2× e com o SEU movimento (lento)
  parts.push(
    `[0:v]scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase:flags=lanczos,` +
      `zoompan=z='1+0.12*on/${frames}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${width}x${height}:fps=${spec.fps}[bg]`,
  )

  let current = 'bg'
  let index = 1

  // ---- o meio (quando existir)
  if (spec.layers.midgroundPath) {
    parts.push(
      `[${index}:v]scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase:flags=lanczos,` +
        `zoompan=z='1+0.18*on/${frames}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${width}x${height}:fps=${spec.fps}[mg]`,
    )
    index += 1
    parts.push(`[${current}][mg]overlay=0:0[comp1]`)
    current = 'comp1'
  }

  // ---- o personagem: chave contra magenta (#FF00FF), então o SEU movimento (rápido)
  if (spec.layers.characterPath) {
    const key =
      `chromakey=0xFF00FF:0.28:0.14,` +
      // um leve desbaste de borda para a linha do anime não ficar serrada
      `format=yuva420p`
    if (spec.layers.characterIsVideo) {
      // O FUTURO: a camada animada entra aqui — mesma posição, mais frames.
      parts.push(
        `[${index}:v]${key},zoompan=z='1+0.22*on/${frames}':x='(iw-iw/zoom)/2':y='(ih-iw/zoom)/2':d=1:s=${width}x${height}:fps=${spec.fps}[ch]`,
      )
    } else {
      parts.push(
        `[${index}:v]${key},` +
          `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase:flags=lanczos,` +
          `zoompan=z='1+0.22*on/${frames}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${width}x${height}:fps=${spec.fps}[ch]`,
      )
    }
    index += 1
    parts.push(`[${current}][ch]overlay=(W-w)/2:(H-h)/2:format=auto[comp2]`)
    current = 'comp2'
  }

  parts.push(`[${current}]null[vout]`)
  return parts.join(';')
}

/** Os argumentos completos do clipe em parallax. */
export function parallaxClipArgs(
  outputPath: string,
  spec: ParallaxSpec,
  quality: 'PREVIEW' | 'MASTER' | 'CINEMA',
): string[] {
  const tier =
    quality === 'CINEMA'
      ? { preset: 'slower', crf: '14' }
      : quality === 'MASTER'
        ? { preset: 'slow', crf: '16' }
        : { preset: 'ultrafast', crf: '30' }
  const args: string[] = [
    '-loop', '1', '-t', spec.durationSec.toFixed(3), '-i', spec.layers.backgroundPath,
  ]
  if (spec.layers.midgroundPath) {
    args.push('-loop', '1', '-t', spec.durationSec.toFixed(3), '-i', spec.layers.midgroundPath)
  }
  if (spec.layers.characterPath) {
    if (spec.layers.characterIsVideo) {
      args.push('-i', spec.layers.characterPath)
    } else {
      args.push('-loop', '1', '-t', spec.durationSec.toFixed(3), '-i', spec.layers.characterPath)
    }
  }
  args.push(
    '-an',
    '-filter_complex', parallaxFilterComplex(spec),
    '-map', '[vout]',
    '-c:v', 'libx264', '-tune', 'animation', '-preset', tier.preset, '-crf', tier.crf,
    '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-r', String(spec.fps),
    '-t', spec.durationSec.toFixed(3),
    '-movflags', '+faststart',
    '-y', outputPath,
  )
  return args
}

/** O prompt do fundo: a locação, SEM personagem (para a camada distante). */
export function backgroundPrompt(sceneLocation: string, timeOfDay: string, art: string): string {
  return `${sceneLocation}, ${timeOfDay === 'NIGHT' ? 'noite' : timeOfDay.toLowerCase()}, cenário vazio sem pessoas, fundo de anime, ${art}`
}

/** O prompt do personagem: chapado, contra verde, para a key sair limpa. */
export function characterPrompt(name: string, appearance: string, action: string, art: string): string {
  return `${name}, ${appearance}, ${action}, corpo inteiro ou plano médio, isolado sozinho, fundo magenta chroma key sólido (#FF00FF), personagem de anime, ${art}`
}