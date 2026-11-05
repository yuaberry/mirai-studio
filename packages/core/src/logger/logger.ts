/**
 * LoggerService — structured, categorized, rotating logs (spec §14, §17).
 *
 * Design notes:
 * - Entries go to an in-memory ring buffer (feeds the Diagnostics panel)
 *   and to rotating JSONL files under userData/logs.
 * - File writes use synchronous appends: a logging path must never have
 *   async races (an open fd racing a rotation rename can silently lose files).
 *   Logging is not a hot path — video/media work never goes through here.
 * - Renderer listeners receive throttled batches through `subscribe`.
 */
import { mkdirSync, renameSync, rmSync, statSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LogEntry, LogLevel, LogCategory, LogQuery } from '@mirai/shared'

export interface LoggerOptions {
  logDir: string
  /** Ring buffer size (entries kept for the Diagnostics panel). */
  maxBuffer?: number
  /** Max size of the current log file before rotation. */
  maxFileBytes?: number
  /** How many rotated files to keep (mirai-1.log ... mirai-N.log). */
  keepFiles?: number
  /** Minimum level kept in the BUFFER (files always keep debug+). */
  minBufferLevel?: LogLevel
}

export type Logger = Pick<LoggerService, 'debug' | 'info' | 'warn' | 'error' | 'log'>

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warning: 2, error: 3 }

export class LoggerService {
  private readonly buffer: LogEntry[] = []
  private readonly listeners = new Set<(entries: LogEntry[]) => void>()
  private readonly pending: LogEntry[] = []
  private readonly maxBuffer: number
  private readonly maxFileBytes: number
  private readonly keepFiles: number
  private readonly minBufferLevel: LogLevel
  private readonly logDir: string
  private readonly filePath: string
  private bytesWritten = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: LoggerOptions) {
    this.maxBuffer = options.maxBuffer ?? 2_000
    this.maxFileBytes = options.maxFileBytes ?? 5 * 1024 * 1024
    this.keepFiles = options.keepFiles ?? 5
    this.minBufferLevel = options.minBufferLevel ?? 'info'
    this.logDir = options.logDir
    this.filePath = join(options.logDir, 'mirai.log')
    mkdirSync(this.logDir, { recursive: true })
    this.bytesWritten = fileExists(this.filePath) ? statSync(this.filePath).size : 0
  }

  debug(category: LogCategory, message: string, data?: unknown): void {
    this.write('debug', category, message, data)
  }

  info(category: LogCategory, message: string, data?: unknown): void {
    this.write('info', category, message, data)
  }

  warn(category: LogCategory, message: string, data?: unknown): void {
    this.write('warning', category, message, data)
  }

  error(category: LogCategory, message: string, data?: unknown): void {
    this.write('error', category, message, data)
  }

  log(level: LogLevel, category: LogCategory, message: string, data?: unknown): void {
    this.write(level, category, message, data)
  }

  /** Recent entries, newest first, honoring filters. */
  recent(query: LogQuery = {}): LogEntry[] {
    const limit = query.limit ?? 200
    let entries = this.buffer
    if (query.level && query.level !== 'all') {
      entries = entries.filter((e) => e.level === query.level)
    }
    if (query.category && query.category !== 'all') {
      entries = entries.filter((e) => e.category === query.category)
    }
    if (query.search && query.search.trim().length > 0) {
      const needle = query.search.trim().toLowerCase()
      entries = entries.filter((e) => e.message.toLowerCase().includes(needle))
    }
    return entries.slice(-limit).reverse()
  }

  /** Subscribe to throttled batches of new entries. Returns unsubscribe. */
  subscribe(listener: (entries: LogEntry[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Clear buffer and start a fresh current file. Rotated files are kept. */
  clear(): void {
    this.buffer.length = 0
    this.pending.length = 0
    this.rotate()
  }

  /** Absolute path of the logs directory (Diagnostics "reveal" button). */
  get logsDir(): string {
    return this.logDir
  }

  /** Flush pending listener batches (app quit). */
  close(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushToListeners()
  }

  // ---------------------------------------------------------------- private

  private write(level: LogLevel, category: LogCategory, message: string, data?: unknown): void {
    const entry: LogEntry = { ts: Date.now(), level, category, message }
    if (data !== undefined) {
      entry.data = safeData(data)
    }

    // Buffer (feeds UI)
    if (LEVEL_ORDER[level] >= LEVEL_ORDER[this.minBufferLevel]) {
      this.buffer.push(entry)
      if (this.buffer.length > this.maxBuffer) {
        this.buffer.splice(0, this.buffer.length - this.maxBuffer)
      }
      this.pending.push(entry)
      this.scheduleFlush()
    }

    // File (always, even debug) — synchronous append, never racy.
    try {
      const line = JSON.stringify(entry) + '\n'
      appendFileSync(this.filePath, line)
      this.bytesWritten += Buffer.byteLength(line)
      if (this.bytesWritten >= this.maxFileBytes) this.rotate()
    } catch {
      // Never let logging break the app.
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushToListeners()
    }, 250)
  }

  private flushToListeners(): void {
    if (this.pending.length === 0 || this.listeners.size === 0) return
    const batch = this.pending.splice(0, this.pending.length)
    for (const listener of this.listeners) {
      try {
        listener(batch)
      } catch {
        // listener errors must not break logging
      }
    }
  }

  /**
   * Rotate: shift the mirai-N chain up by one and drop the file beyond
   * retention. The current file is guaranteed to exist (we just appended to it).
   */
  private rotate(): void {
    try {
      for (let i = this.keepFiles - 1; i >= 1; i--) {
        const from = this.rotatedPath(i)
        const to = this.rotatedPath(i + 1)
        if (fileExists(from)) renameSync(from, to)
      }
      if (fileExists(this.filePath)) renameSync(this.filePath, this.rotatedPath(1))
      const beyond = this.rotatedPath(this.keepFiles + 1)
      if (fileExists(beyond)) rmSync(beyond, { force: true })
    } catch {
      // Rotation is best-effort.
    }
    this.bytesWritten = 0
  }

  private rotatedPath(index: number): string {
    return join(this.logDir, `mirai-${index}.log`)
  }
}

function fileExists(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

function safeData(data: unknown): unknown {
  if (data instanceof Error) {
    return { name: data.name, message: data.message }
  }
  try {
    JSON.stringify(data)
    return data
  } catch {
    return String(data)
  }
}

