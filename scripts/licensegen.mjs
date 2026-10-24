#!/usr/bin/env node
/**
 * licensegen.mjs — mint Mirai Studio Pro license keys (DEVELOPER TOOL).
 *
 * The private key NEVER lives in the repository. Keep it offline
 * (e.g. a USB key / password manager) and pass its path here:
 *
 *   node scripts/licensegen.mjs --private-key ~/mirai-license-private.pem \
 *     --holder "fan@example.com" --tier pro --features mature --days 365
 *
 * Output: a license key the user pastes into Settings → Content.
 */
import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { sign, createPrivateKey } from 'node:crypto'

const { values } = parseArgs({
  options: {
    'private-key': { type: 'string' },
    holder: { type: 'string' },
    tier: { type: 'string', default: 'pro' },
    features: { type: 'string', default: 'mature' },
    days: { type: 'string' }, // omit for lifetime
  },
})

if (!values['private-key'] || !values.holder) {
  console.error('Usage: node scripts/licensegen.mjs --private-key <pem> --holder <email/name> [--days N] [--features mature]')
  process.exit(1)
}

const priv = createPrivateKey(readFileSync(values['private-key'], 'utf8'))
const nowSec = Math.floor(Date.now() / 1000)
const payload = {
  v: 1,
  holder: values.holder,
  tier: values.tier,
  features: values.features.split(',').map((f) => f.trim()).filter(Boolean),
  iat: nowSec,
  exp: values.days ? nowSec + Number(values.days) * 86400 : null,
}
const payloadJson = JSON.stringify(payload)
const sig = sign(null, Buffer.from(payloadJson, 'utf8'), priv)
const key = `${Buffer.from(payloadJson, 'utf8').toString('base64url')}.${sig.toString('base64url')}`
console.log('--- MIRAI STUDIO PRO LICENSE ---')
console.log(key)
console.log('-------------------------------')
console.log(JSON.stringify(payload))
