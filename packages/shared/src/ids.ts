/**
 * Internal entity identifiers. All IDs are ULIDs (26 chars, Crockford base32).
 * The app NEVER relies on absolute paths as identity — IDs are the only stable handle.
 */
import { z } from 'zod'

export type EntityId = string

/** ULID shape: 26 chars of Crockford base32 (no I, L, O, U). */
export const ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

export function isValidEntityId(value: string): value is EntityId {
  return ID_PATTERN.test(value)
}

export const zEntityId = z.string().regex(ID_PATTERN, 'Must be a ULID (26 chars)')

/** ISO-8601 datetime string. */
export const zIsoDate = z.string().datetime({ offset: true })
