/**
 * project.mirai manifest — the portable identity of a project (spec §5).
 * Written atomically (tmp + rename) so a crash can never leave it half-written.
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { MiraiError, ProjectManifest, type ProjectManifest as Manifest } from '@mirai/shared'

export const MANIFEST_FILENAME = 'project.mirai'

export function readManifest(projectDir: string): Manifest {
  const filePath = join(projectDir, MANIFEST_FILENAME)
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    throw new MiraiError(
      'PROJECT_INVALID',
      `This folder is not a Mirai project — "${MANIFEST_FILENAME}" is missing.`,
    )
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new MiraiError('PROJECT_INVALID', `"${MANIFEST_FILENAME}" is corrupted (invalid JSON).`)
  }
  const parsed = ProjectManifest.safeParse(data)
  if (!parsed.success) {
    throw new MiraiError('PROJECT_INVALID', `"${MANIFEST_FILENAME}" has invalid content.`, {
      details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    })
  }
  return parsed.data
}

export function writeManifest(projectDir: string, manifest: Manifest): void {
  const filePath = join(projectDir, MANIFEST_FILENAME)
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  renameSync(tmpPath, filePath)
}
