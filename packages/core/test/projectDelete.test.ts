/**
 * ProjectService.deleteProject — the FOREVER delete.
 *
 * The requirement it answers: "apague e não deixe nada desse anime
 * experimental para trás, nem o dossiê". So the test proves, on a real
 * folder with a real SQLite database:
 *
 *   - the project folder is gone (frames, audio, dossier, exports…);
 *   - the backups of that project are gone;
 *   - the registry entry is gone;
 *   - the derived-work links are gone;
 *   - and the guard refuses to wipe a folder that is not a project.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MiraiError, ProjectConfig } from '@mirai/shared'
import { setupEnv } from './helpers'

function makeConfig(title: string): ProjectConfig {
  return ProjectConfig.parse({ title })
}

describe('ProjectService.deleteProject', () => {
  it('erases the folder, the backups and the registry entry', async () => {
    const env = setupEnv('delete')
    const summary = env.projects.create({
      name: 'E2E Experimental — LGBT & Artes Marciais',
      dir: env.dirs.projectsDefaultDir,
      config: makeConfig('E2E Experimental'),
    })

    // Files the experiment leaves behind: frames, audio, the dossier.
    const frames = join(summary.path, 'images', 'generated')
    mkdirSync(frames, { recursive: true })
    writeFileSync(join(frames, 'frame-1.jpg'), 'fake-jpeg')
    const dossier = join(summary.path, 'exports')
    mkdirSync(dossier, { recursive: true })
    writeFileSync(join(dossier, 'dossier.txt'), 'the dossier')
    writeFileSync(join(dossier, 'dossier.pdf'), '%PDF-1.4 fake')

    // A backup of the project (copies of its data live outside the folder).
    const backupDir = join(env.dirs.backups, summary.id, '20260101-000000')
    mkdirSync(backupDir, { recursive: true })
    writeFileSync(join(backupDir, 'project.sqlite'), 'backup')

    expect(env.projects.list(true).some((p) => p.id === summary.id)).toBe(true)

    const result = await env.projects.deleteProject(summary.id)

    expect(result.path).toBe(summary.path)
    expect(result.files).toBeGreaterThan(0)
    expect(result.bytes).toBeGreaterThan(0)

    // The folder — and everything in it — is gone.
    expect(existsSync(summary.path)).toBe(false)
    expect(existsSync(frames)).toBe(false)
    expect(existsSync(dossier)).toBe(false)
    // The backups are gone too.
    expect(existsSync(join(env.dirs.backups, summary.id))).toBe(false)
    // The registry entry is gone.
    expect(env.projects.list(true).some((p) => p.id === summary.id)).toBe(false)
  })

  it('closes the open project first, so no database handle is left behind', async () => {
    const env = setupEnv('delete-open')
    const summary = env.projects.create({
      name: 'Open Project',
      dir: env.dirs.projectsDefaultDir,
      config: makeConfig('Open Project'),
    })
    await env.projects.open(summary.path)
    expect(env.projects.current()).not.toBeNull()

    await env.projects.deleteProject(summary.id)

    expect(env.projects.current()).toBeNull()
    expect(existsSync(summary.path)).toBe(false)
  })

  it('removes the derived-work links of the deleted project', async () => {
    const env = setupEnv('delete-derived')
    const parent = env.projects.create({
      name: 'Parent',
      dir: env.dirs.projectsDefaultDir,
      config: makeConfig('Parent'),
    })
    const child = env.projects.create({
      name: 'Child',
      dir: env.dirs.projectsDefaultDir,
      config: makeConfig('Child'),
    })

    env.appDb
      .prepare(
        `INSERT INTO derived_works (id, parent_project_id, child_project_id, kind, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('dw-test', parent.id, child.id, 'SEQUEL', '2026-01-01T00:00:00.000Z')

    await env.projects.deleteProject(parent.id)

    const rows = env.appDb
      .prepare('SELECT id FROM derived_works WHERE parent_project_id = ? OR child_project_id = ?')
      .all(parent.id, parent.id) as Array<{ id: string }>
    expect(rows).toHaveLength(0)
    // The child project itself is untouched.
    expect(existsSync(child.path)).toBe(true)
  })

  it('refuses to delete a folder that is not a project', async () => {
    const env = setupEnv('delete-guard')
    // The guard compares against the real paths — the projects folder of
    // the test env is inside a tmpdir, and its ancestors are protected.
    const protectedDir = env.dirs.projectsDefaultDir

    await expect(env.projects.deleteProject('does-not-exist')).rejects.toBeInstanceOf(MiraiError)
    expect(existsSync(protectedDir)).toBe(true)
  })

  it('never deletes the projects folder itself', async () => {
    const env = setupEnv('delete-guard-root')
    // A registry entry that points at the projects folder (a corrupted or
    // malicious row) must NOT wipe every project.
    env.appDb
      .prepare(
        `INSERT INTO project_registry (id, name, path, status, created_at, updated_at, app_version)
         VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?)`,
      )
      .run(
        'evil-id',
        'Evil',
        env.dirs.projectsDefaultDir,
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
        '0.0.0-test',
      )

    await expect(env.projects.deleteProject('evil-id')).rejects.toBeInstanceOf(MiraiError)
    expect(existsSync(env.dirs.projectsDefaultDir)).toBe(true)
  })
})
