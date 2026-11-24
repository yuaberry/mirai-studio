/**
 * Release label — the alpha version must be IMPOSSIBLE to mistake for stable.
 * The user asked for the alpha to be highlighted in the app; these tests pin
 * the mapping so a future version scheme cannot silently lose it.
 */
import { describe, expect, it } from 'vitest'
import { describeRelease } from '../src/release'

describe('describeRelease', () => {
  it('highlights the ALPHA builds with their number', () => {
    const r = describeRelease('2.1.1-alpha.1')
    expect(r.tone).toBe('alpha')
    expect(r.text).toBe('V2.1.1 Alfa 1')
  })

  it('keeps alpha.2 and alpha.10 distinct (not a decorative suffix)', () => {
    expect(describeRelease('2.1.1-alpha.2').text).toBe('V2.1.1 Alfa 2')
    expect(describeRelease('2.1.1-alpha.10').text).toBe('V2.1.1 Alfa 10')
  })

  it('treats beta as its own legacy tone', () => {
    const r = describeRelease('2.1.0-beta.1')
    expect(r.tone).toBe('beta')
    expect(r.text).toContain('Beta')
  })

  it('renders stable versions plainly', () => {
    const r = describeRelease('3.0.0')
    expect(r.tone).toBe('stable')
    expect(r.text).toBe('Mirai Studio v3.0.0')
  })

  it('survives a missing version (dev run without metadata)', () => {
    expect(describeRelease(undefined).tone).toBe('dev')
    expect(describeRelease('').tone).toBe('dev')
  })

  it('does NOT mistake an unpackaged Electron version for a real release', () => {
    // A dev run without package metadata leaks the Electron version through
    // app.getVersion() — e.g. "33.4.11". That must never read as a release.
    const r = describeRelease('33.4.11')
    expect(r.tone).toBe('stable')
    expect(r.text).toContain('v33.4.11')
    expect(r.tone).not.toBe('alpha')
  })
})
