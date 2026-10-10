/**
 * SQLite connection factory with production-safe pragmas.
 */
import DatabaseConstructor from 'better-sqlite3'
import type { Database } from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type { Database }

export function openDatabase(path: string): Database {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseConstructor(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('synchronous = NORMAL')
  return db
}

/** Checkpoint the WAL so the file can be copied consistently (backups). */
export function checkpointWal(db: Database): void {
  db.pragma('wal_checkpoint(TRUNCATE)')
}
