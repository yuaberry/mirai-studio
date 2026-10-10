/**
 * LicenseService (Pro) — offline Ed25519 license validation.
 *
 * Keys are minted with scripts/licensegen.mjs (private key NEVER lives in
 * this repo) and validated locally with the embedded production public key.
 * Tests/smoke inject their own runtime keypair — same code path, real crypto.
 */
import { verify as cryptoVerify, createPublicKey, KeyObject } from 'node:crypto'
import {
  LICENSE_FEATURES,
  LicensePayload,
  type LicenseFeature,
  type LicensePayload as LicensePayloadType,
  type LicenseStatus,
} from '@mirai/shared'

/** PRODUCTION public key (raw Ed25519, base64). Keep the private key offline. */
export const MIRAI_LICENSE_PUBLIC_KEY_B64 = 'T/Dj53csZwhTnFwl4tQa2P3CeAJJlQ/SHaX25d4hSKE='

function ed25519PublickeyFromB64(b64: string): KeyObject {
  // Raw 32-byte Ed25519 public keys need the SPKI wrapper Node expects.
  const raw = Buffer.from(b64, 'base64')
  const spki = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    raw,
  ])
  return createPublicKey({ key: spki, format: 'der', type: 'spki' })
}

export class LicenseService {
  private readonly publicKey: KeyObject

  constructor(publicKeyB64: string = MIRAI_LICENSE_PUBLIC_KEY_B64) {
    this.publicKey = ed25519PublickeyFromB64(publicKeyB64)
  }

  /**
   * Validates a `base64url(payload).base64url(sig)` license key.
   * Checks signature, payload schema and expiry — fully offline.
   */
  validate(key: string): LicenseStatus {
    const trimmed = key.trim()
    const parts = trimmed.split('.')
    if (parts.length !== 2 || parts[0]!.length === 0 || parts[1]!.length === 0) {
      return { valid: false, reason: 'Malformed key — expected a two-part code.', payload: null }
    }
    let payloadBytes: Buffer
    let sig: Buffer
    try {
      payloadBytes = Buffer.from(parts[0]!, 'base64url')
      sig = Buffer.from(parts[1]!, 'base64url')
    } catch {
      return { valid: false, reason: 'Malformed key encoding.', payload: null }
    }
    const sigOk = cryptoVerify(null, payloadBytes, this.publicKey, sig)
    if (!sigOk) {
      return { valid: false, reason: 'Signature check failed — the key was not issued for this app or was tampered with.', payload: null }
    }
    let rawPayload: unknown
    try {
      rawPayload = JSON.parse(payloadBytes.toString('utf8'))
    } catch {
      return { valid: false, reason: 'Malformed key payload.', payload: null }
    }
    const parsed = LicensePayload.safeParse(rawPayload)
    if (!parsed.success) {
      return { valid: false, reason: 'Key payload does not match this version.', payload: null }
    }
    const payload = parsed.data as LicensePayloadType
    if (payload.exp !== null && payload.exp * 1000 < Date.now()) {
      return { valid: false, reason: 'This license has expired.', payload: null }
    }
    return { valid: true, reason: null, payload }
  }

  /** Whether a validated status unlocks a specific premium feature. */
  static hasFeature(status: LicenseStatus, feature: LicenseFeature): boolean {
    return status.valid && status.payload !== null && status.payload.features.includes(feature)
  }

  /** All known features (for status endpoints/UI). */
  static features(): readonly LicenseFeature[] {
    return LICENSE_FEATURES
  }
}
