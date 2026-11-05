/**
 * v0.10 — licensing (Ed25519, injected keypair), mature policy (adults-only
 * enforcement), genre filtering and Blender bridge guards.
 */
import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign as cryptoSign, createPrivateKey } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError, LicensePayload, filterGenres, ANIME_GENRES } from '@mirai/shared'
import { LicenseService } from '../src/license/licenseService'
import { assertExplicitCastAllowed, assessAge, maturePipelineActive } from '../src/license/maturePolicy'
import { BlenderBridge } from '../src/blender/blenderBridge'
import { StoryboardService } from '../src/storyboard/storyboardService'
import { CreativeService } from '../src/creative/creativeService'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { makeClock } from './helpers'

// ---------------------------------------------------------------- license



describe('LicenseService (real Ed25519)', () => {
  // One runtime keypair for the whole suite — the production private key
  // never exists in this repo; tests exercise the exact same code path.
  const pair = generateKeyPairSync('ed25519')
  const rawPublic = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
  const publicKeyB64 = Buffer.from(rawPublic).toString('base64')
  const service = new LicenseService(publicKeyB64)

  function mint(payload: object): string {
    const json = JSON.stringify(payload)
    const sig = cryptoSign(null, Buffer.from(json, 'utf8'), pair.privateKey)
    return `${Buffer.from(json, 'utf8').toString('base64url')}.${sig.toString('base64url')}`
  }
  
  const base = {
    v: 1 as const,
    holder: 'fan@example.com',
    tier: 'pro' as const,
    features: ['mature'] as Array<'mature'>,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86_400 * 365,
  }

  it('validates a genuine key and exposes its features', () => {
    const status = service.validate(mint(base))
    expect(status.valid).toBe(true)
    expect(status.payload?.holder).toBe('fan@example.com')
    expect(LicenseService.hasFeature(status, 'mature')).toBe(true)
  })

  it('rejects tampered payloads, foreign signatures and garbage', () => {
    const good = mint(base)
    const [payloadPart, sigPart] = good.split('.')
    // Tampered payload with the original signature.
    const tamperedPayload = Buffer.from(JSON.stringify({ ...base, features: ['mature'], holder: 'someone-else' })).toString('base64url')
    expect(service.validate(`${tamperedPayload}.${sigPart}`).valid).toBe(false)
    // Foreign key signature.
    const other = generateKeyPairSync('ed25519')
    const foreignSig = cryptoSign(null, Buffer.from(JSON.stringify(base)), other.privateKey)
    expect(service.validate(`${payloadPart}.${foreignSig.toString('base64url')}`).valid).toBe(false)
    // Garbage.
    expect(service.validate('not-a-key').valid).toBe(false)
    expect(service.validate('aaa.bbb').valid).toBe(false)
  })

  it('rejects expired keys and validates lifetime ones', () => {
    const expired = service.validate(
      mint({ ...base, exp: Math.floor(Date.now() / 1000) - 10 }),
    )
    expect(expired.valid).toBe(false)
    expect(expired.reason).toContain('expired')
    const lifetime = service.validate(mint({ ...base, exp: null }))
    expect(lifetime.valid).toBe(true)
    // Payload schema guard.
    const weird = service.validate(mint({ v: 2, holder: 'x', tier: 'pro', features: [], iat: 1, exp: null }))
    expect(weird.valid).toBe(false)
  })

  it('the embedded production public key validates the documented format only', () => {
    const prod = new LicenseService()
    expect(prod.validate('garbage').valid).toBe(false)
  })
})

// ---------------------------------------------------------------- mature policy

describe('MaturePolicy — adults only, enforced in code', () => {
  const adult = { id: 'a', age: '21' } as never
  const adultWords = { id: 'b', age: 'adult' } as never
  const minor = { id: 'c', age: '16' } as never
  const minorWord = { id: 'd', age: 'high school student' } as never
  const ambiguous = { id: 'e', age: '' } as never

  it('assesses ages correctly', () => {
    expect(assessAge('21').kind).toBe('ADULT')
    expect(assessAge('19 anos').kind).toBe('ADULT')
    expect(assessAge('adult').kind).toBe('ADULT')
    expect(assessAge('15').kind).toBe('MINOR')
    expect(assessAge('a child').kind).toBe('MINOR')
    expect(assessAge('').kind).toBe('AMBIGUOUS')
    expect(assessAge('unknown').kind).toBe('AMBIGUOUS')
  })

  it('explicit generation requires explicit adults — minors and unknowns blocked', () => {
    expect(() => assertExplicitCastAllowed([adult, adultWords])).not.toThrow()
    expect(() => assertExplicitCastAllowed([minor])).toThrow(MiraiError)
    expect(() => assertExplicitCastAllowed([minorWord])).toThrow(MiraiError)
    expect(() => assertExplicitCastAllowed([ambiguous])).toThrow(/explicit adult age/i)
  })

  it('the mature pipeline only activates for rated-18+ projects with the mode on', () => {
    const manifest = { config: { contentRating: '18+' } } as never
    const safe = { config: { contentRating: '13+' } } as never
    expect(maturePipelineActive(manifest, true)).toBe(true)
    expect(maturePipelineActive(manifest, false)).toBe(false)
    expect(maturePipelineActive(safe, true)).toBe(false)
  })

  it('mature genres are hidden until the mode is enabled', () => {
    const safe = filterGenres(ANIME_GENRES, false)
    expect(safe).not.toContain('Hentai')
    expect(safe).toContain('Yuri') // regular taxonomy stays
    const mature = filterGenres(ANIME_GENRES, true)
    expect(mature).toContain('Hentai')
    expect(mature).toContain('Erotica')
  })
})

// ---------------------------------------------------------------- blender

describe('BlenderBridge', () => {
  it('attaches real .blend files to shots and guards the format', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mirai-blend-'))
    const db = openDatabase(join(dir, 'project.sqlite'))
    runMigrations(db, PROJECT_DB_MIGRATIONS)
    const clock = makeClock()
    const creative = new CreativeService(db, clock)
    const storyboard = new StoryboardService(db, clock, dir)
    const bridge = new BlenderBridge(storyboard, dir)
    const episode = creative.createEpisode({ season: 1, number: 1, title: 'One' })
    const scene = creative.createScene(episode.id, { title: 'Scene' })
    const shot = storyboard.createShot(scene.id, { title: 'Shot' })

    const blend = join(dir, 'scene.blend')
    writeFileSync(blend, Buffer.from('BLENDER-blendfile-bytes'))
    const asset = bridge.attachBlend(shot.id, blend)
    expect(asset.kind).toBe('BLENDER')
    expect(storyboard.getShotById(shot.id).blendAssetId).toBe(asset.id)

    // Wrong extension rejected.
    const notBlend = join(dir, 'scene.obj')
    writeFileSync(notBlend, Buffer.from('x'))
    expect(() => bridge.attachBlend(shot.id, notBlend)).toThrow(MiraiError)
  })

  it('renderShot fails cleanly without a Blender binary and detect() never throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mirai-blend-detect-'))
    const db = openDatabase(join(dir, 'project.sqlite'))
    runMigrations(db, PROJECT_DB_MIGRATIONS)
    const clock = makeClock()
    const creative = new CreativeService(db, clock)
    const storyboard = new StoryboardService(db, clock, dir)
    const bridge = new BlenderBridge(storyboard, dir, '/nonexistent/blender-binary-for-tests')
    const detect = bridge.detect()
    expect(detect.available).toBe(false)
    const episode = creative.createEpisode({ season: 1, number: 1, title: 'One' })
    const scene = creative.createScene(episode.id, { title: 'Scene' })
    const shot = storyboard.createShot(scene.id, { title: 'Shot' })
    const blend = join(dir, 'scene.blend')
    writeFileSync(blend, Buffer.from('BLENDER'))
    bridge.attachBlend(shot.id, blend)
    expect(bridge.renderShot(shot, 2, () => undefined, { aborted: false })).rejects.toThrow(/Blender wasn't found/)
  })
})

void createPrivateKey
void LicensePayload
