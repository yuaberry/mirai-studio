import { describe, expect, it } from 'vitest'
import {
  AppSettings,
  MiraiError,
  ProjectConfig,
  ProjectManifest,
  JobRecord,
  toErrorPayload,
  fromErrorPayload,
  ipcContracts,
  IPC_CHANNELS,
  PROJECT_PRESETS,
  presetById,
  PromptRecord,
  AiModelInfo,
  ChatMessage,
} from '../src'

const validConfig = ProjectConfig.parse({ title: 'Sakura Chronicles' })

describe('ProjectConfig', () => {
  it('fills defaults from a minimal input', () => {
    expect(validConfig).toMatchObject({
      title: 'Sakura Chronicles',
      language: 'ja',
      aspectRatio: '16:9',
      fps: 24,
      resolution: { width: 1920, height: 1080 },
    })
  })

  it('rejects unsupported FPS and bad resolutions', () => {
    expect(() => ProjectConfig.parse({ title: 'x', fps: 123 })).toThrow()
    expect(() => ProjectConfig.parse({ title: 'x', resolution: { width: 0, height: 100 } })).toThrow()
  })

  it('ships the template presets (spec §32)', () => {
    expect(PROJECT_PRESETS.length).toBeGreaterThanOrEqual(8)
    expect(presetById('anime-12')?.config.episodeCount).toBe(12)
    expect(presetById('does-not-exist')).toBeUndefined()
  })
})

describe('ProjectManifest', () => {
  it('accepts a full manifest and rejects a wrong schemaVersion', () => {
    const manifest = ProjectManifest.parse({
      schemaVersion: 1,
      id: '01H5P2Z3A4B5C6D7E8F9G0J1K2',
      name: 'Sakura',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.2.0',
      config: validConfig,
    })
    expect(manifest.status).toBe('ACTIVE')

    expect(() =>
      ProjectManifest.parse({
        schemaVersion: 2,
        id: '01H5P2Z3A4B5C6D7E8F9G0J1K2',
        name: 'Sakura',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        appVersion: '0.2.0',
        config: validConfig,
      }),
    ).toThrow()
  })

  it('rejects malformed ULIDs', () => {
    expect(() =>
      ProjectManifest.parse({
        schemaVersion: 1,
        id: 'not-a-ulid',
        name: 'Sakura',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        appVersion: '0.2.0',
        config: validConfig,
      }),
    ).toThrow()
  })
})

describe('AppSettings', () => {
  it('derives full defaults from an empty object', () => {
    const settings = AppSettings.parse({})
    expect(settings.general.locale).toBe('en')
    expect(settings.ai.temperature).toBe(0.7)
    expect(settings.appearance.theme).toBe('dark')
  })

  it('merges partial nested objects over defaults', () => {
    const settings = AppSettings.parse({ ai: { temperature: 1.5 } })
    expect(settings.ai.temperature).toBe(1.5)
    expect(settings.ai.maxTokens).toBe(2_048)
  })
})

describe('JobRecord', () => {
  it('round-trips a persisted shape', () => {
    const job = JobRecord.parse({
      id: '01H5P2Z3A4B5C6D7E8F9G0J1K2',
      type: 'project.validate',
      status: 'QUEUED',
      priority: 5,
      attempts: 0,
      maxAttempts: 3,
      scheduledAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(job.interrupted).toBe(false)
    expect(job.startedAt).toBeNull()
  })
})

describe('PromptRecord', () => {
  it('validates a library entry', () => {
    const prompt = PromptRecord.parse({
      id: '01H5P2Z3A4B5C6D7E8F9G0J1K2',
      category: 'MANGA_PANEL',
      title: 'Rain Confession',
      body: 'A manga panel, rain, two girls.',
      tags: 'manga, rain',
      builtin: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(prompt.category).toBe('MANGA_PANEL')
  })

  it('rejects an unknown category', () => {
    expect(() =>
      PromptRecord.parse({
        id: '01H5P2Z3A4B5C6D7E8F9G0J1K2',
        category: 'NOT_REAL',
        title: 'x',
        body: 'y',
        builtin: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow()
  })
})

describe('AI wire types', () => {
  it('validates chat messages and model catalog entries', () => {
    expect(ChatMessage.parse({ role: 'user', content: 'hi' })).toMatchObject({ role: 'user' })
    const model = AiModelInfo.parse({
      id: 'free/m',
      name: 'Free M',
      contextLength: 32000,
      isFree: true,
      promptPricePerToken: 0,
      completionPricePerToken: 0,
    })
    expect(model.isFree).toBe(true)
  })
})

describe('error model', () => {
  it('serializes MiraiError with code + retryable', () => {
    const payload = toErrorPayload(
      new MiraiError('IO_ERROR', 'disk full', { retryable: true, details: { dev: 'sda' } }),
    )
    expect(payload).toMatchObject({ code: 'IO_ERROR', message: 'disk full', retryable: true })
    const revived = fromErrorPayload(payload)
    expect(revived).toBeInstanceOf(MiraiError)
    expect(revived.code).toBe('IO_ERROR')
  })

  it('converts zod errors into VALIDATION_ERROR with issue details', () => {
    try {
      ProjectConfig.parse({ title: '' })
    } catch (err) {
      const payload = toErrorPayload(err)
      expect(payload.code).toBe('VALIDATION_ERROR')
      expect(Array.isArray(payload.details)).toBe(true)
    }
  })
})

describe('IPC contracts', () => {
  it('every channel has request and response schemas', () => {
    for (const channel of IPC_CHANNELS) {
      const contract = ipcContracts[channel]
      expect(contract.request).toBeDefined()
      expect(contract.response).toBeDefined()
    }
    expect(IPC_CHANNELS).toContain('projects:create')
    expect(IPC_CHANNELS).toContain('ai:chat')
    expect(IPC_CHANNELS).toContain('prompts:list')
    expect(IPC_CHANNELS).toContain('system:health')
  })

  it('credentials never cross the bridge in plaintext — only status', () => {
    expect(IPC_CHANNELS).toContain('credentials:status')
    expect(IPC_CHANNELS).not.toContain('credentials:get')
  })
})
