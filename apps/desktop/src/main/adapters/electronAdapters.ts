/**
 * OS-facing adapters: paths (Electron) and secure credentials (safeStorage).
 */
import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import type { AppDirs, SecureCodec } from '@mirai/core'
import type { LoggerService } from '@mirai/core'

export function electronDirs(): AppDirs {
  const userData = app.getPath('userData')
  return {
    root: userData,
    logs: join(userData, 'logs'),
    backups: join(userData, 'backups'),
    projectsDefaultDir: join(app.getPath('documents'), 'MiraiProjects'),
    appDb: join(userData, 'app.sqlite'),
  }
}

/**
 * OS-backed encryption for credentials (spec §15). Falls back to plaintext
 * ONLY when the platform keychain is unavailable — and that fact is surfaced
 * in Settings UI and logs, never silently.
 */
export function createSecureCodec(logger: LoggerService): SecureCodec {
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn(
      'SYSTEM',
      'OS secure storage unavailable — credentials will be stored WITHOUT encryption.',
    )
    return {
      isSecure: false,
      encrypt: (plain) => Buffer.from(plain, 'utf8'),
      decrypt: (data) => data.toString('utf8'),
    }
  }
  return {
    isSecure: true,
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  }
}
