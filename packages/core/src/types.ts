/**
 * Core port interfaces. The core package is Electron-free: everything that
 * touches the OS (paths, encryption, clocks) is injected through these ports,
 * which makes the whole domain layer unit-testable with plain node.
 */
import type { EntityId } from '@mirai/shared'
import { ulid } from 'ulid'

/** Injectable clock (tests can fast-forward). */
export interface Clock {
  now(): Date
  isoNow(): string
}

export const systemClock: Clock = {
  now: () => new Date(),
  isoNow: () => new Date().toISOString(),
}

export interface AppDirs {
  /** Root userData directory. */
  root: string
  /** Rotating log files. */
  logs: string
  /** Project backups. */
  backups: string
  /** Default parent dir for new projects. */
  projectsDefaultDir: string
  /** Absolute path of the App DB file. */
  appDb: string
}

/**
 * Credential encryption port. Implemented with Electron `safeStorage` in the
 * main process; a plaintext fallback is used only when the OS keychain is
 * unavailable (surfaced to the user with a warning — never silently).
 */
export interface SecureCodec {
  /** True when the OS-backed secure storage is available. */
  readonly isSecure: boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

/** Plaintext fallback codec — flagged insecure, warned in the UI. */
export const plaintextCodec: SecureCodec = {
  isSecure: false,
  encrypt: (plain: string) => Buffer.from(plain, 'utf8'),
  decrypt: (data: Buffer) => data.toString('utf8'),
}

/** New ULID for entities. */
export function newEntityId(): EntityId {
  // ULID is monotonic within the same millisecond — safe for bulk inserts.
  return ulid() as EntityId
}

/** Safe JSON parse returning undefined on failure. */
export function parseJson(text: string | null | undefined): unknown {
  if (text == null) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
