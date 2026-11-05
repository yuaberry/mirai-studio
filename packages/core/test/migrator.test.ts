import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/db/connection'
import { runMigrations, type Migration } from '../src/db/migrator'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sample: Migration[] = [
  {
    name: '0001_init',
    up: (db) => db.exec('CREATE TABLE demo (id TEXT PRIMARY KEY)'),
  },
  {
    name: '0002_add_name',
    up: (db) => db.exec('ALTER TABLE demo ADD COLUMN name TEXT'),
  },
]

describe('migrator', () => {
  it('applies pending migrations in order and records them', () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'mirai-migr-')), 'x.sqlite'))
    const result = runMigrations(db, sample)
    expect(result.applied).toEqual(['0001_init', '0002_add_name'])
    db.prepare("INSERT INTO demo (id, name) VALUES ('1', 'mirai')").run()
    expect(db.prepare('SELECT name FROM demo').get()).toEqual({ name: 'mirai' })
    db.close()
  })

  it('is idempotent — second run applies nothing', () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'mirai-migr-')), 'x.sqlite'))
    runMigrations(db, sample)
    const again = runMigrations(db, sample)
    expect(again.applied).toEqual([])
    db.close()
  })

  it('applies only the new migration when a list grows', () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'mirai-migr-')), 'x.sqlite'))
    runMigrations(db, sample.slice(0, 1))
    const result = runMigrations(db, sample)
    expect(result.applied).toEqual(['0002_add_name'])
    db.close()
  })

  it('rejects duplicate migration names', () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'mirai-migr-')), 'x.sqlite'))
    const broken = [...sample, { ...sample[0]! }]
    expect(() => runMigrations(db, broken)).toThrow(/Duplicate migration/)
    db.close()
  })
})
