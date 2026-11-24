/**
 * Release label (v2.1) — ONE derivation of the version string, in a PURE
 * module so the sidebar and the status bar can never drift apart, and so the
 * label is unit-tested instead of eyeballed.
 *
 * WHY THIS EXISTS
 * ---------------
 * The user asked for the ALPHA version to be HIGHLIGHTED in the app and in
 * the release. That means the interface must be able to tell an alpha from a
 * beta from a stable build WITHOUT hardcoding strings per component — a
 * hardcoded label is exactly the bug that shipped "V33.4.11" to the sidebar
 * once (that was Electron's own version leaking through `app.getVersion()`
 * in an unpackaged run; deriving the label from the REAL version — and
 * naming its tone — makes that class of mistake visible instead of silent).
 *
 * The tone is what the UI paints: alpha gets the loud "experimental" pill,
 * beta the neutral legacy pill, stable the quiet dot.
 */

export type ReleaseTone = 'alpha' | 'beta' | 'dev' | 'stable'

export interface ReleaseInfo {
  /** Ready to render, e.g. "V2.1.1 Alfa 1". */
  text: string
  tone: ReleaseTone
}

/** The version → label mapping. Exported for tests. */
export function describeRelease(appVersion: string | undefined | null): ReleaseInfo {
  if (!appVersion) return { text: 'Mirai Studio', tone: 'dev' }

  // 2.1.1-alpha.3 → "V2.1.1 Alfa 3"
  const alpha = /^(\d+\.\d+\.\d+)-alpha\.(\d+)$/.exec(appVersion)
  if (alpha) return { text: `V${alpha[1]} Alfa ${alpha[2]}`, tone: 'alpha' }

  // Legacy beta builds keep their historical wording.
  const beta = /-beta\.(\d+)$/.exec(appVersion)
  if (beta) return { text: `V1 Beta Experimental ${beta[1]}`, tone: 'beta' }

  return { text: `Mirai Studio v${appVersion}`, tone: 'stable' }
}