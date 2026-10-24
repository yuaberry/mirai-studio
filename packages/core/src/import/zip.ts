/**
 * Zip reader/writer (dependency-free, core) — the importer reads archives
 * with it and the EPUB writer packages valid books with it. Mirrors the
 * smoke fixtures: EOCD scan -> local headers -> inflateRaw.
 */
import { inflateRawSync, deflateRawSync } from 'node:zlib'

export interface ZipEntry {
  name: string
  data: Buffer
}

/** CRC-32 (zip spec polynomial). */
export function zipCrc32(buf: Buffer | Uint8Array): number {
  let c: number
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = (table[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Minimal ZIP reader: EOCD -> central directory -> entries (stored|deflate). */
export function readZipEntries(buffer: Buffer, maxEntries = 200): ZipEntry[] {
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66_000); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a valid .zip archive (no end-of-directory record).')
  const entryCount = buffer.readUInt16LE(eocd + 10)
  let pos = buffer.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  for (let n = 0; n < entryCount && entries.length < maxEntries; n++) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== 0x02014b50) break
    const method = buffer.readUInt16LE(pos + 10)
    const compressedSize = buffer.readUInt32LE(pos + 20)
    const nameLen = buffer.readUInt16LE(pos + 28)
    const extraLen = buffer.readUInt16LE(pos + 30)
    const commentLen = buffer.readUInt16LE(pos + 32)
    const localOffset = buffer.readUInt32LE(pos + 42)
    const name = buffer.subarray(pos + 46, pos + 46 + nameLen).toString('utf8')
    pos += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) continue
    const lNameLen = buffer.readUInt16LE(localOffset + 26)
    const lExtraLen = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    try {
      entries.push({ name, data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw) })
    } catch {
      /* a corrupt entry never kills the read */
    }
  }
  return entries
}

export interface ZipWriteEntry {
  name: string
  data: Buffer | string
  /** STORED = no compression (EPUB mimetype MUST be stored+first). */
  method?: 'store' | 'deflate'
  date?: Date
}

/** Minimal ZIP writer (stored + deflate) with a valid central directory. */
export function writeZipEntries(entries: ZipWriteEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const data = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : e.data
    const crc = zipCrc32(data)
    const stored = e.method === 'store' ? data : deflateRawSync(data)
    const method = e.method === 'store' ? 0 : 8
    const d = e.date ?? new Date(0)
    // MS-DOS time/date (fixed epoch keeps builds deterministic).
    const dosTime = ((d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1)) & 0xffff
    const dosDate = (((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()) & 0xffff

    const local = Buffer.alloc(30 + nameBuf.length + stored.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuf.copy(local, 30)
    stored.copy(local, 30 + nameBuf.length)
    locals.push(local)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(stored.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)
    centrals.push(central)
    offset += local.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}
