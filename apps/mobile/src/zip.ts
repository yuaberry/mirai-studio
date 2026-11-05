/**
 * Minimal zip reader for the companion (stored + deflate entries) — reads
 * project backups and zipped notes on the phone. Uses pako for inflate.
 */
import { inflate as inflateRaw } from 'pako'

export interface ZipTextFile {
  name: string
  text: string
}

export function readZipTexts(buffer: ArrayBuffer, maxEntries = 80): ZipTextFile[] {
  const b = new Uint8Array(buffer)
  const out: ZipTextFile[] = []
  // EOCD scan from the tail.
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66_000); i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Arquivo .zip inválido (sem diretório central).')
  const entryCount = b[eocd + 10] | (b[eocd + 11] << 8)
  let pos = b[eocd + 16] | (b[eocd + 17] << 8) | (b[eocd + 18] << 16) | (b[eocd + 19] << 24)

  for (let n = 0; n < entryCount; n++) {
    if (pos + 46 > b.length) break
    if (!(b[pos] === 0x50 && b[pos + 1] === 0x4b && b[pos + 2] === 0x01 && b[pos + 3] === 0x02)) break
    const method = b[pos + 10] | (b[pos + 11] << 8)
    const compressedSize = b[pos + 20] | (b[pos + 21] << 8) | (b[pos + 22] << 16) | (b[pos + 23] << 24)
    const nameLen = b[pos + 28] | (b[pos + 29] << 8)
    const localOffset = b[pos + 42] | (b[pos + 43] << 8) | (b[pos + 44] << 16) | (b[pos + 45] << 24)
    const name = new TextDecoder().decode(b.subarray(pos + 46, pos + 46 + nameLen))
    pos += 46 + nameLen + (b[pos + 30] | (b[pos + 31] << 8)) + (b[pos + 32] | (b[pos + 33] << 8))
    if (name.endsWith('/')) continue
    if (!/\.(txt|json|md)$/i.test(name)) continue
    if (out.length >= maxEntries) break
    const lNameLen = b[localOffset + 26] | (b[localOffset + 27] << 8)
    const lExtraLen = b[localOffset + 28] | (b[localOffset + 29] << 8)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const raw = b.subarray(dataStart, dataStart + compressedSize)
    try {
      const data = method === 0 ? raw : inflateRaw(raw)
      const text = new TextDecoder().decode(data)
      if (text.length > 0) out.push({ name, text })
    } catch {
      /* skip corrupt entry */
    }
  }
  return out
}
