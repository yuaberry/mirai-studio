/**
 * probe-video.ts — o que de ANIMAÇÃO existe hoje, de verdade, nesta máquina.
 * Roda com o container do app para usar as credenciais REAIS do usuário.
 */
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ProjectService,
  LoggerService,
  openDatabase,
  runMigrations,
  systemClock,
  plaintextCodec,
  APP_DB_MIGRATIONS,
  type AppDirs,
} from '@mirai/core'

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'mirai-probe-'))
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
  const projects = new ProjectService({ appDb, dirs, clock: systemClock, appVersion: 'probe', logger, onJobUpdated: () => undefined })
  void projects
}

// As credenciais vivem no perfil REAL do usuário (não no temp) — abrir direto.
import { openDatabase as openReal } from '@mirai/core'
import { runMigrations as migrateReal } from '@mirai/core'
import { CredentialStore } from '@mirai/core'
import { existsSync } from 'node:fs'
const realDbPath = join(process.env.HOME!, '.config/@mirai/desktop/app.sqlite')
if (!existsSync(realDbPath)) {
  console.log('perfil real não encontrado em', realDbPath)
} else {
  void (async () => {
    const db = openReal(realDbPath)
    migrateReal(db, APP_DB_MIGRATIONS)
    const creds = new CredentialStore(db, plaintextCodec, systemClock)
    const nvidia = creds.get('nvidia')
    const openrouter = creds.get('openrouter')
    console.log('nvidia key:', nvidia ? `${nvidia.slice(0, 8)}…(${nvidia.length})` : 'AUSENTE')
    console.log('openrouter key:', openrouter ? `${openrouter.slice(0, 8)}…(${openrouter.length})` : 'AUSENTE')

    if (nvidia) {
      // 1. O catálogo da NVIDIA: tem VÍDEO?
      try {
        const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
          headers: { Authorization: `Bearer ${nvidia}` },
        })
        console.log('NIM /models:', res.status)
        if (res.ok) {
          const body = (await res.json()) as { data?: Array<{ id: string }> }
          const videoish = (body.data ?? []).filter((m) => /video|cosmos|animate|wan|svd|genie|sora|kling/i.test(m.id))
          console.log('modelos NIM:', body.data?.length ?? 0, '| video-ish:', videoish.length)
          console.log(videoish.slice(0, 8).map((m) => m.id).join('\n') || '(nenhum)')
        }
      } catch (e) {
        console.log('NIM ERR:', (e as Error).message)
      }
    }

    if (openrouter) {
      // 2. OpenRouter: tem VÍDEO?
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${openrouter}` },
        })
        console.log('OpenRouter /models:', res.status)
        if (res.ok) {
          const body = (await res.json()) as { data?: Array<{ id: string; modality?: string }> }
          const videoish = (body.data ?? []).filter((m) => /video|animate|kling|hailuo|sora|veo|wan/i.test(m.id))
          console.log('modelos OR:', body.data?.length ?? 0, '| video-ish:', videoish.length)
          console.log(videoish.slice(0, 8).map((m) => m.id).join('\n') || '(nenhum)')
        }
      } catch (e) {
        console.log('OR ERR:', (e as Error).message)
      }
    }
    logger.close()
  })()
}