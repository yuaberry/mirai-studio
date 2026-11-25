#!/usr/bin/env bun
/**
 * Mirai Studio collaboration server — CLI.
 *
 *   bun src/cli.ts --port 8787 --root ./published
 *
 * Options:
 *   --port   Port to listen on (default 8787)
 *   --host   Interface to bind (default 0.0.0.0)
 *   --root   Where published projects live (default ./published)
 *   --name   Public name of this registry
 */
import { mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { PublishStore } from './publishStore'
import { AccountStore } from './accountStore'
import { SyncStore } from './syncStore'
import { createMiraiServer } from './httpServer'

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : fallback
}

const port = Number(arg('port', '8787'))
const host = arg('host', '0.0.0.0')
// v2.1: o canal em tempo real. SEM --with-sync, o servidor é o de antes
// (publicar/baixar) — nada muda para quem já o usava.
const withSync = process.argv.includes('--with-sync')
// An ABSOLUTE --root is used as given; only a relative one is resolved against
// the current directory. MEASURED: joining an absolute path silently nested it
// under the cwd (`apps/server/tmp/opencode/...`), publishing into nowhere.
  const rootArg = arg('root', 'published')
  const root = isAbsolute(rootArg) ? rootArg : join(process.cwd(), rootArg)
const name = arg('name', 'Mirai Studio registry')

mkdirSync(root, { recursive: true })
const store = new PublishStore({ root })
// Accounts live beside the published projects, in their own SQLite file.
const accounts = new AccountStore(join(root, '.accounts'))
const sync = withSync ? new SyncStore(join(root, '.sync')) : undefined
const { server, listen } = createMiraiServer({ store, accounts, sync, port, host, serverName: name })
await listen(port, host)

console.log(`\n  MIRAI STUDIO — collaboration server`)
console.log(`  name     ${name}`)
console.log(`  root     ${root}
  accounts ${join(root, '.accounts')}/accounts.sqlite (register/login/revoke)`)
console.log(`  listen   ${host}:${port}`)
  console.log(
    withSync
      ? `  sync     ON — /events (SSE) + /ops (o celular manda, o computador executa)\n           os eventos ficam em ${join(root, '.sync')}`
      : `  sync     OFF (use --with-sync para o canal em tempo real com o celular)`,
  )
console.log(`\n  Point Mirai Studio at  Settings → Collaboration → ${host === '0.0.0.0' ? 'localhost' : host}:${port}`)
console.log(`  Projects published: ${store.list().length}\n`)

const shutdown = () => {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2_000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)