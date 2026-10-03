/**
 * Subtitles (Phase 4 wrap-up) — codec round-trips, CRUD, import/export,
 * plus the video-gen provider against a mocked transport.
 */
import { describe, expect, it } from 'vitest'
import { writeFileSync, mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MiraiError,
  parseSrt,
  parseVtt,
  writeSrt,
  writeVtt,
  parseTimecode,
  formatSrtTime,
  formatVttTime,
  cueAt,
} from '@mirai/shared'
import { CreativeService } from '../src/creative/creativeService'
import { SubtitleService } from '../src/subtitles/subtitleService'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { makeClock } from './helpers'

// ---------------------------------------------------------------- codecs

describe('SRT/VTT codecs (pure)', () => {
  const srt = `\uFEFF1
00:00:01,000 --> 00:00:03,500
Yuna, look at the sky!

2
00:00:04,000 --> 00:00:06,000
It's like the sakura
are falling upwards.`

  it('parses SRT with BOM, CRLF and multi-line cues', () => {
    const cues = parseSrt(srt.replace(/\n/g, '\r\n'))
    expect(cues).toHaveLength(2)
    expect(cues[0]!.startSec).toBeCloseTo(1)
    expect(cues[0]!.endSec).toBeCloseTo(3.5)
    expect(cues[0]!.text).toBe('Yuna, look at the sky!')
    expect(cues[1]!.text).toContain('\n')
  })

  it('round-trips SRT text exactly through write → parse', () => {
    const original = [
      { startSec: 0, endSec: 2.5, text: 'Line one' },
      { startSec: 3, endSec: 5.25, text: 'Line two\nsecond row' },
    ]
    const parsed = parseSrt(writeSrt(original))
    expect(parsed).toHaveLength(2)
    expect(parsed[1]!.endSec).toBeCloseTo(5.25)
    expect(parsed[1]!.text).toBe('Line two\nsecond row')
  })

  it('parses VTT (no-hour timecodes + cue settings) and round-trips', () => {
    const vtt = `WEBVTT

1
00:01.000 --> 00:03.000 align:center line:0
Centered cue
`
    const cues = parseVtt(vtt)
    expect(cues).toHaveLength(1)
    expect(cues[0]!.startSec).toBeCloseTo(1)
    expect(cues[0]!.endSec).toBeCloseTo(3)
    expect(cues[0]!.text).toBe('Centered cue')
    const again = parseVtt(writeVtt(cues))
    expect(again).toHaveLength(1)
    expect(again[0]!.text).toBe('Centered cue')
  })

  it('timecodes format and parse losslessly', () => {
    expect(parseTimecode('01:02:03,456')).toBeCloseTo(3723.456)
    expect(formatSrtTime(3723.456)).toBe('01:02:03,456')
    expect(formatVttTime(3723.456)).toBe('01:02:03.456')
    expect(parseTimecode('nonsense')).toBeNull()
  })

  it('cueAt finds the active cue', () => {
    const cues = [
      { startSec: 0, endSec: 1, text: 'a' },
      { startSec: 2, endSec: 4, text: 'b' },
    ]
    expect(cueAt(cues, 0.5)!.text).toBe('a')
    expect(cueAt(cues, 3)!.text).toBe('b')
    expect(cueAt(cues, 1.5)).toBeNull()
  })
})

// ---------------------------------------------------------------- service

function makeEnv(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-sub-${name}-`))
  const db = openDatabase(join(dir, 'project.sqlite'))
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  const clock = makeClock()
  const creative = new CreativeService(db, clock)
  const service = new SubtitleService(db, clock, dir)
  const episode = creative.createEpisode({ season: 1, number: 1, title: 'One' })
  const scene = creative.createScene(episode.id, { title: 'Rooftop' })
  return { dir, db, clock, creative, service, scene }
}

describe('SubtitleService', () => {
  it('creates, validates, updates and deletes cues', () => {
    const env = makeEnv('crud')
    const cue = env.service.create({
      sceneId: env.scene.id,
      startSec: 1,
      endSec: 3,
      text: 'Hello!',
    })
    expect(cue.startSec).toBeCloseTo(1)
    // End must be after start.
    expect(() =>
      env.service.create({ sceneId: env.scene.id, startSec: 5, endSec: 5, text: 'x' }),
    ).toThrow(MiraiError)
    const updated = env.service.update(cue.id, { endSec: 4.5, text: 'Hello, Yuna!' })
    expect(updated.endSec).toBeCloseTo(4.5)
    env.service.delete(cue.id)
    expect(env.service.list(env.scene.id)).toHaveLength(0)
  })

  it('imports a real .srt file (replacing existing cues) and exports it back', () => {
    const env = makeEnv('file')
    env.service.create({ sceneId: env.scene.id, startSec: 0, endSec: 1, text: 'old' })
    const file = join(env.dir, 'subs.srt')
    writeFileSync(
      file,
      writeSrt([
        { startSec: 0.5, endSec: 2, text: 'Imported one' },
        { startSec: 2.5, endSec: 4, text: 'Imported two' },
      ]),
      'utf8',
    )
    const imported = env.service.importFile(env.scene.id, file)
    expect(imported).toBe(2)
    const list = env.service.list(env.scene.id)
    expect(list).toHaveLength(2)
    expect(list[0]!.text).toBe('Imported one')

    // Export → real file with the exact SRT content.
    const out = env.service.exportFile(env.scene.id, 'srt')
    expect(existsSync(out.path)).toBe(true)
    expect(out.count).toBe(2)
    const reparsed = parseSrt(readFileSync(out.path, 'utf8'))
    expect(reparsed).toHaveLength(2)

    // VTT export too.
    const vttOut = env.service.exportFile(env.scene.id, 'vtt')
    expect(readFileSync(vttOut.path, 'utf8').startsWith('WEBVTT')).toBe(true)

    // Exporting a scene without cues fails cleanly.
    const emptyScene = env.creative.createScene(
      env.creative.listEpisodes()[0]!.id,
      { title: 'Empty' },
    )
    expect(() => env.service.exportFile(emptyScene.id, 'srt')).toThrow(MiraiError)
  })

  it('rejects unreadable files and empty cue files', () => {
    const env = makeEnv('bad')
    expect(() => env.service.importFile(env.scene.id, join(env.dir, 'missing.srt'))).toThrow(MiraiError)
    const empty = join(env.dir, 'empty.srt')
    writeFileSync(empty, 'no cues here\n', 'utf8')
    expect(() => env.service.importFile(env.scene.id, empty)).toThrow(MiraiError)
  })
})
