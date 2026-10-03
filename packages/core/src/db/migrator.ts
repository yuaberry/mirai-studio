/**
 * Versioned migration runner (spec §23: "Utilizar migrations").
 * Both the App DB and each Project DB are migrated through this runner, so
 * opening a project created by an older Mirai version upgrades it safely.
 */
import type { Database } from './connection'

export interface Migration {
  /** Unique, lexicographically ordered (e.g. `0001_init`). */
  name: string
  up: (db: Database) => void
}

export interface MigrationResult {
  applied: string[]
  alreadyApplied: string[]
}

export function runMigrations(db: Database, migrations: Migration[]): MigrationResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)

  // Detect duplicates — a broken migration list must never run half-way.
  const seen = new Set<string>()
  for (const migration of migrations) {
    if (seen.has(migration.name)) {
      throw new Error(`Duplicate migration name: ${migration.name}`)
    }
    seen.add(migration.name)
  }

  const alreadyApplied = new Set(
    (
      db.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>
    ).map((row) => row.name),
  )

  const applied: string[] = []
  const ordered = [...migrations].sort((a, b) => a.name.localeCompare(b.name))

  for (const migration of ordered) {
    if (alreadyApplied.has(migration.name)) continue
    const tx = db.transaction(() => {
      migration.up(db)
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        new Date().toISOString(),
      )
    })
    tx()
    applied.push(migration.name)
  }

  return {
    applied,
    alreadyApplied: [...alreadyApplied],
  }
}
