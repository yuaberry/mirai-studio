# Architecture

```
Renderer (React)                main/views: Hub · Bible · Characters · Locations
                                Episodes · Prompt Library · AI Assist · Jobs · Backups
                                Settings · Diagnostics
   │ typed client (lib/ipc)     TanStack Query · Zustand · design system (system/)
   ▼ preload (contextBridge, sandbox: true)
Main (Electron = Node backend)  ipc/register.ts (thin, zod-validated both ways)
                                bootstrap.ts (DI) · ai/aiHost.ts · system/health.ts
   ▼
@mirai/ai   OpenRouterProvider (injected FetchLike) · ModelRegistry · ContextBuilder
@mirai/core ProjectService · CreativeService · PromptService · JobQueue · Settings · Logger
@mirai/shared  entities · zod schemas · IPC contracts · error model
```

## Phase 2 additions

- **Provider layer**: `AIProvider` interface with declared capabilities; `OpenRouterProvider`
  implements chat, SSE streaming and public model discovery over an injected `FetchLike` port —
  the whole AI core is testable without a network (16 tests).
- **AiHost** (main): orchestrates streaming chats — consent-based context collection
  (Story Bible / cast / current scene only when toggled), token batching (~40ms), abort via
  `AbortController`, cost estimation from catalog pricing, `ai:chunk`/`ai:done`/`ai:error`
  push events.
- **Prompt Library**: per-project table (`0003_prompt_library`) seeded idempotently with 12
  built-in professional manga/anime prompts (deterministic ULID-shaped ids from slugs).
  Built-ins are editable, never deletable.
- **AI Assist** (renderer): streaming chat, Ctrl+Enter send, Stop button, context toggles with
  explicit privacy notice, mini-markdown renderer for replies, Prompt Library seeding.

## Error model

Every failure crossing IPC serializes as `{code, message, retryable, details}` — the UI renders
useful errors with real actions (Retry / Open Settings / Open Logs), never "Something went wrong".
AI errors map cleanly: 401 → re-enter key, 429/5xx → retryable, network → `AI_OFFLINE`.
