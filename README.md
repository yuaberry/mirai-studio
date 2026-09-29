# MIRAI STUDIO

**AI-Native Anime & Animation Production Studio** — *From imagination to animation.*

A professional, local-first desktop studio for creating anime, animation, manga, visual novels and
other audiovisual works. Modular, provider-agnostic, testable and honest: no fake buttons, no dead UI.

```
Story → World → Characters → Script → Storyboard → Assets → Animation
      → Voice → Music → Sound → Editing → Review → Export
```

## Status — v0.2.0

| Phase | Capability | State |
|---|---|---|
| 0 — Foundation | Electron+React app, typed IPC (zod both ways), SQLite + migrations, project lifecycle, backups, persistent job queue + crash recovery, settings, encrypted credentials, logger + Diagnostics, command palette (Ctrl+K) | ✅ |
| 1 — Creative Core | Story Bible (autosave), Character Studio, Locations, Episodes & Scenes (cast, location, time of day, screenplay text, reorder), creative data travels with duplicates/backups | ✅ |
| 2 — AI Core (first slice) | Real OpenRouter provider (chat/stream/model discovery via injected transport), model registry with TTL cache + FREE flags, consent-based context builder, streaming AI Assist chat with abort + cost estimate, live model picker in Settings | ✅ |
| — Prompt Library | 12 built-in professional manga/anime prompts (panels, character sheets, keyframes, style anchors, negatives, story tools), user CRUD, tags, copy, "Use in Assist" | ✅ |
| — Packaging | `.deb` (primary) + AppImage + portable dir, brand icon, boot-tested binaries | ✅ |

**Verification:** `bun run verify` → typecheck (4 workspaces) + **79 tests** + production build +
**18-step end-to-end smoke** (project → creative → prompts → AI provider integration → backup/restore → crash recovery). All green.

## Quick start

```bash
bun install
node apps/desktop/node_modules/electron/install.js   # if electron dist/ missing
bun run rebuild:native                                # compile better-sqlite3 for Electron
bun run verify
bun run dev        # launch with HMR
```

Installers: `bun run package:linux` → `apps/desktop/release/` (`mirai-studio_0.2.0_amd64.deb` +
AppImage). `sudo apt install ./mirai-studio_0.2.0_amd64.deb`.

| Script | Purpose |
|---|---|
| `bun run verify` | Full gate: typecheck → tests → build → E2E smoke |
| `bun run dev` / `build` / `start` | Dev (HMR) / production build / run built app |
| `bun run package:linux` | `.deb` + AppImage installers |
| `bun run rebuild:native` | Recompile better-sqlite3 against Electron |
| `bun run icons` | Regenerate the icon set from `build/icon.svg` |

> Tests touching `better-sqlite3` run under `ELECTRON_RUN_AS_NODE=1` (Electron's own Node) so the
> binary ABI matches the shipped app exactly.

## Layout

```
apps/desktop     Electron app (main = Node backend; renderer = React UI)
packages/shared  Types, zod schemas, IPC contracts — single source of truth
packages/core    Electron-free domain: db, projects, jobs, creative, prompts, settings
packages/ai      AI core: OpenRouter provider, SSE, model registry, context builder
docs/            Architecture, decisions, packaging, roadmap
```

**Dependency rule:** `renderer → shared (types) → main handlers → services`.
`@mirai/core`/`@mirai/ai` never import Electron — OS ports are injected.

## Security

- `contextIsolation` + `sandbox` + CSP; every IPC request **and** response zod-validated.
- API keys encrypted via OS keychain (`safeStorage`); renderer only ever sees `configured: true/false`.
- AI context is **opt-in**: only the toggles you enable (Story Bible / Cast / Scene) leave the
  machine, with a clear privacy notice in the AI Assist header.

## Docs

- [Architecture](docs/architecture.md) · [Decisions](docs/decisions.md) · [Packaging](docs/packaging.md) · [Roadmap](docs/roadmap.md)
