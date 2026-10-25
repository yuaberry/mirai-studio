/**
 * ASS codec round-trips (Phase 4 wrap-up completion).
 */
import { describe, expect, it } from 'vitest'
import { parseAss, writeAss, formatAssTime, parseAssTime } from '../src/entities/subtitle'

describe('ASS codec', () => {
  it('formats centisecond timecodes', () => {
    expect(formatAssTime(0)).toBe('0:00:00.00')
    expect(formatAssTime(3661.5)).toBe('1:01:01.50')
    expect(formatAssTime(2)).toBe('0:00:02.00')
  })

  it('parses valid timecodes and rejects garbage', () => {
    expect(parseAssTime('0:00:01.25')).toBe(1.25)
    expect(parseAssTime('10:00:00.00')).toBe(36000)
    expect(parseAssTime('00:00:01,000')).toBeNull()
    expect(parseAssTime('nonsense')).toBeNull()
  })

  it('round-trips cues through write → parse', () => {
    const cues = [
      { startSec: 0, endSec: 1.5, text: 'Hello world' },
      { startSec: 2, endSec: 3.25, text: 'Line one\nLine two' },
    ]
    const text = writeAss(cues)
    expect(text).toContain('[Script Info]')
    expect(text).toContain('Dialogue: 0,0:00:00.00,0:00:01.50,Default,,0,0,0,,Hello world')
    const back = parseAss(text)
    expect(back).toHaveLength(2)
    expect(back[0]).toEqual(cues[0])
    expect(back[1]).toEqual(cues[1])
  })

  it('strips override tags and honors text commas', () => {
    const file = [
      '[Script Info]',
      'ScriptType: v4.00+',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\i1}Bold, with comma{\\i0} \\Nand a second line',
    ].join('\n')
    const cues = parseAss(file)
    expect(cues).toHaveLength(1)
    expect(cues[0]!.text).toBe('Bold, with comma\nand a second line')
  })

  it('ignores comments and non-Dialogue lines', () => {
    const file = [
      '[Script Info]',
      '; a comment with Dialogue: inside',
      'Comment: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,note',
      'Format: Layer, Start, End',
      'Dialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,real cue',
    ].join('\n')
    const cues = parseAss(file)
    expect(cues).toHaveLength(1)
    expect(cues[0]!.text).toBe('real cue')
  })
})
