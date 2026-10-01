# MIRAI STUDIO — MASTER PLAN & PERSISTENT MEMORY

> **THIS FILE IS THE SINGLE SOURCE OF TRUTH FOR THE ENTIRE PROJECT.**
> When the conversation context is compacted, this file carries ALL state forward.
> Read it fully before doing ANYTHING.

---

## 1. PRODUCT VISION

**Mirai Studio** is an AI-Native, local-first, professional anime/animation production studio — a desktop app (Electron) that takes a creator from initial idea ("I want to create a yuri romance anime in a magic school") all the way to final exported MP4.

**Target quality**: comparable to KONOSUBA, RE:ZERO, My Dress-Up Darling, and other works by studios like Kodansha, Toei Animation, Wit Studio, Kyoto Animation, Aniplex (Sony Group), A-1 Pictures, CloverWorks, White Fox, Diomédea, Studio DEEN, Seven Arcs, ROLL2, Silver Link.

**Core flow** (the "master flow" — every step must eventually work end-to-end):
```
CREATE PROJECT → CHARACTER → LOCATION → EPISODE → SCENE → WRITE DIALOGUE
→ STORYBOARD → GENERATE IMAGE → ADD IMAGE TO SHOT → ADD VOICE → ADD MUSIC
→ TIMELINE → RENDER → EXPORT MP4
```

**Identity**: "From imagination to animation." Dark-first UI, sakura-pink → violet → cyan gradient brand.

---

## 2. USER REQUIREMENTS (verbatim from conversation)

- **"eu utilizo a NVIDIA com o GLM 5.3"** → Chat provider: NVIDIA NIM with model `nvidia/z-ai/glm-5.3`, endpoint `https://integrate.api.nvidia.com/v1`. Implemented and selectable in Settings → Providers.
- **"quero que use o melhor modelo de geração de video e imagem que tiver disponivel grátis"** → Image generation works with ANY OpenAI Images-compatible endpoint (user configures in Settings → Providers). Video generation contract exists but needs a real provider wired (Phase 4 continuation or Phase 5).
- **"sempre se lembre que eu quero a geração de video do anime com consistencia de Estúdio Profissional"** → `buildImagePrompt()` bakes Style Bible + shot camera metadata + scene context + cast into EVERY image request. Same logic must extend to video generation.
- **"adicionar todos os gêneros dos animes, TODOS"** → ~55 genre tags implemented (Isekai, Ecchi, Harem, Shounen, Shoujo, Seinen, Josei, Kodomo, Psychological, Dark Fantasy, Yuri, Vampire, Zombie, Time Travel, etc.) at project creation + config editor.
- **"quero ótimas qualidades, para competir com estúdios profissionais"** → Every module must be real and functional. No fake buttons, no "Coming Soon", no mock data.
- **GitHub repo for info & download** → https://github.com/yuaberry/mirai-studio (public)
- **Animated download website** → https://yuaberry.github.io/mirai-studio (GitHub Pages, sakura particles, genre marquee, download buttons)
- **Always create Plan.md on request** → this file. When user says "crie o arquivo Plan.md", regenerate this file with current state and commit to GitHub.

---

## 3. TECHNICAL STACK (locked in)

| Layer | Technology | Reason |
|---|---|---|
| Desktop shell | **Electron 33.x** (node 20.18) | TS backend, safeStorage, worker_threads, native modules |
| Frontend | **React 18 + Vite** (electron-vite) | HMR, ecosystem |
| State | **Zustand** (UI) + **TanStack Query v5** (server data) | Clean separation |
| Database | **SQLite (better-sqlite3)** + versioned SQL migrations | Sync, fast, local-first, portable per project |
| AI (chat) | **OpenRouterProvider** (OpenAI-compatible, injected `FetchLike` port) | Works with OpenRouter AND NVIDIA NIM (GLM) via baseUrl switch |
| AI (images) | **OpenAIImagesProvider** (`POST /images/generations`, b64 response) | Works with any compatible endpoint |
| Build | **Bun ≥ 1.1** (workspaces) | Fast installs, TS execution |
| Packaging | **electron-builder 24.x** | .deb (primary) + AppImage |
| Icons | **sharp** (librsvg) | Full SVG gradient support |
| UI | **Tailwind CSS 3** + custom tokens | Dark-first design system |
| Fonts | **Inter Variable + Space Grotesk Variable** (@fontsource) | Professional typography |
| Command palette | **cmdk** | Ctrl+K |
| Icons (UI) | **lucide-react** | Professional icon set |
| Native module | **better-sqlite3** compiled via `@electron/rebuild` for Electron ABI | |

### Monorepo structure
```
mirai-studio/
├── apps/desktop/
│   ├── src/main/           # Electron main process (backend)
│   │   ├── adapters/       # electronDirs, safeStorage codec
│   │   ├── ai/aiHost.ts    # Multi-provider chat orchestration
│   │   ├── assets/assetProtocol.ts  # mirai-asset:// custom protocol
│   │   ├── bootstrap.ts    # DI container
│   │   ├── ipc/router.ts   # Typed IPC (zod both ways)
│   │   ├── ipc/register.ts # ALL IPC handlers (91 handlers, 90 contracts)
│   │   └── system/health.ts
│   ├── src/preload/        # contextBridge (sandbox: true)
│   ├── src/renderer/       # React UI
│   │   └── src/
│   │       ├── shell/       # AppShell, Sidebar, StatusBar, CommandPalette, ProjectHeader
│   │       ├── modules/     # hub, bible, style, characters, locations, episodes,
│   │       │                # storyboard, prompts, media, assist, settings,
│   │       │                # workspace (Overview/Jobs/Backups), diagnostics
│   │       ├── system/     # Design system: ui.tsx, Modal, Toast, EmptyState, Logo
│   │       ├── lib/         # ipc.ts (typed client), queries.ts (TanStack hooks), utils.ts
│   │       └── store/       # appStore.ts (Zustand)
│   ├── build/icon.svg      # Brand mark source
│   ├── electron.vite.config.ts
│   ├── electron-builder.yml
│   └── scripts/smoke-backend.ts  # 25-step E2E smoke test
├── packages/shared/        # Types, zod schemas, IPC contracts — single source of truth
│   └── src/
│       ├── entities/       # project, creative, storyboard, media, ai, prompt, genres
│       ├── ipc/            # contracts.ts (90 channels), events.ts (push events)
│       ├── errors.ts       # MiraiError with codes (AI_PROVIDER_ERROR, AI_OFFLINE, etc.)
│       ├── status.ts       # Enums: JobStatus, AssetStatus, TaskStatus, LogLevel
│       └── ids.ts          # ULID validation
├── packages/core/          # Electron-free domain core
│   └── src/
│       ├── db/             # connection.ts, migrator.ts, migrations.ts (0001-0006)
│       ├── creative/       # CreativeService (Bible, Characters, Locations, Episodes, Scenes)
│       ├── storyboard/    # StoryboardService (Shots, Frames, Style, Voice, Decisions)
│       ├── media/          # MediaService (Music/SFX/Ambience library)
│       ├── render/         # RenderService (FFmpeg: shot → MP4)
│       ├── prompts/        # PromptService (12 built-in manga prompts)
│       ├── projects/       # ProjectService (lifecycle, backup, recovery)
│       ├── jobs/           # JobQueue (persistent, retry, cancel, recovery)
│       ├── logger/         # LoggerService (ring buffer + rotating files)
│       └── settings/       # SettingsService + CredentialStore
├── packages/ai/            # AI core (transport-free)
│   └── src/
│       ├── openrouter.ts   # OpenAI-compatible chat (streaming, listModels)
│       ├── images.ts       # OpenAI Images-compatible (b64)
│       ├── consistency.ts  # buildImagePrompt() + draftScreenplayInstruction()
│       ├── contextBuilder.ts  # buildSystemPrompt() (consent-scoped)
│       ├── registry.ts     # ModelRegistry (TTL cache)
│       └── sse.ts          # SSE parser
├── website/                # GitHub Pages site (index.html, style.css, app.js)
├── docs/                   # architecture, decisions, setup, packaging, roadmap
└── Plan.md                 # THIS FILE — persistent memory
```

---

## 4. DATABASE SCHEMA (per-project SQLite, migrations 0001-0006)

**App DB** (`appData/app.sqlite`): `project_registry`, `settings` (kv), `credentials` (encrypted blobs)

**Project DB** (`<project>/database/project.sqlite`):

| Migration | Tables |
|---|---|
| 0001_init | `job_records`, `kv_store`, `schema_migrations` |
| 0002_creative_core | `characters`, `locations`, `episodes`, `scenes`, `scene_characters` |
| 0003_prompt_library | `prompts` |
| 0004_storyboard | `assets`, `shots` |
| 0005_voice_tracks | `shots.audio_asset_id` (ALTER) |
| 0006_media_library | `media_tracks`, `scene_media` |
| 0007_timeline_editing | `timeline_tracks`, `timeline_clips`, `timeline_markers`, `keyframes` |
| 0008_production | `tasks`, `crew_members`, `approval_events`, `entity_versions` |
| 0009_subtitles_video | `subtitles`, `shots.video_asset_id` |

**Key design decisions**:
- IDs are ULIDs (26 chars Crockford base32) — never autoincrement
- Timestamps: ISO-8601 strings
- JSON payloads stored as TEXT
- Foreign keys: ON with CASCADE for children, SET NULL for optional refs
- WAL mode, busy_timeout 5000ms

---

## 5. IPC CONTRACTS (140 channels)

All in `packages/shared/src/ipc/contracts.ts` — zod schemas validate requests AND responses.

### By domain:
- **projects:** 17 channels (list, create, open, close, current, duplicate, archive, restore, removeFromList, revealInFolder, pickDirectory, updateConfig, validate, backup, listBackups, restoreBackup, deleteBackup)
- **creative:** 20 channels (story-bible get/update, characters CRUD×4, locations CRUD×4, episodes CRUD×4, scenes CRUD×4 + move)
- **storyboard:** 9 channels (shots CRUD×5 + move, importFrame, clearFrame, assets:reveal)
- **style-bible:** 2 channels (get, update)
- **prompts:** 4 channels (list, create, update, delete)
- **media:** 12 channels (list, import, update, delete, assignToScene, removeFromScene, listSceneMedia, reveal, importVoice, clearVoice)
- **ai:** 9 channels (status, models, chat, abort, draftScreenplay, recordDecision, decisions:list, generateFrame)
- **render:** 2 channels (shot, status)
- **timeline (Phase 5):** 18 channels — get, build, reset, trackCreate/Update/Delete/Move, clipCreate/Update/Move/Split/Delete(+ripple), markerCreate/Delete, keyframesForScene, keyframeList/Upsert/Delete
- **render/export (Phase 6):** 5 channels — render:scene, render:episode, render:outputs, render:revealOutput, render:deleteOutput
- **production (Phase 7):** 17 channels — tasks:list/create/update/setStatus/delete, crew:list/create/delete, approvals:transition/log, versions:list/snapshot/restore/diff, qc:run, analytics:overview
- **subtitles (v0.8):** 6 channels — list/create/update/delete/importFile/exportFile
- **phase 8 AI (v0.8):** 5 channels — ai:analyzeScreenplay/directorNotes/continuityCheck/productionReview/generateVideo
- **jobs:** 5 channels (list, retry, cancel, resumeInterrupted, discardInterrupted)
- **settings/credentials:** 5 channels
- **logs:** 3 channels
- **system:** 2 channels (health, copyText) + window controls

### Push events (main → renderer):
`jobs:updated`, `logs:appended`, `notify`, `project:changed`, `ai:chunk`, `ai:done`, `ai:error`

---

## 6. COMPLETE STATUS — ALL PHASES

### ✅ Phase 0 — Foundation (COMPLETE, v0.1.0 → v0.4.0)
- Electron + React + TypeScript monorepo (bun workspaces)
- Typed IPC contract table (zod both ways)
- SQLite with versioned migrations (App DB + per-Project DB)
- Project lifecycle: create/open/duplicate/archive/restore/removeFromList
- Backups: create, restore (with automatic pre-restore snapshot), delete (last one guarded)
- Portable projects: ULID identity, atomic manifests, move-safe
- Persistent JobQueue with crash recovery (PAUSED → Resume/Discard)
- Settings service (default-merging, corruption-safe)
- Credential store (encrypted via safeStorage, never exposed to renderer)
- Logger: categories, levels, ring buffer (2000), rotating files (5MB × 5)
- Command palette (Ctrl+K)
- Diagnostics: health report + live filterable log tail

### ✅ Phase 1 — Creative Core (COMPLETE, v0.2.0)
- Story Bible: premise, themes, tone, message, rules, concepts, genre notes — autosave
- Character Studio: name, role (6 types), age, personality, appearance, voice, bio, goals, fears, notes, status — master-detail with search
- Location Studio: name, description, climate, architecture, notes
- Episode Manager: seasons/episodes with unique (season, number), synopsis, status, scene count
- Scene Manager: title, cast (N:N via scene_characters), location, time of day, synopsis, screenplay text (the "write dialogue" step), status, reorder ↑↓
- Creative data survives close/reopen and travels with duplicates/backups
- Anime genres: ~55 tags (Isekai, Ecchi, Harem, Psychological, etc.) at creation + editor

### ✅ Phase 2 — AI Core (COMPLETE, v0.3.0)
- **Provider layer**: `OpenRouterProvider` (chat, SSE streaming, model discovery) + `OpenAIImagesProvider` (b64 image generation) — both transport-free via injected `FetchLike`
- **Multi-provider**: user selects OpenRouter OR NVIDIA NIM (GLM 5.3) in Settings → Providers
- **Model Registry**: TTL cache, public discovery, FREE flags
- **AiHost**: streaming chat with abort, token batching (~40ms), cost estimation
- **AI Assist** (UI): streaming chat, Ctrl+Enter send, Stop button, context toggles (Bible/Cast/Scene) with explicit privacy notice, mini-markdown renderer
- **Scene Writer agent**: `ai:draftScreenplay` builds full screenplay from scene context → user reviews in modal → [Apply to Scene] / [Discard] / [Regenerate] (human-in-the-loop)
- **Decision Log**: accepted AI proposals become project memory (`ai:decisions:list`)
- **Studio Consistency Prompt Builder**: `buildImagePrompt()` bakes Style Bible + shot camera + scene/cast + extra direction into every image request
- **Error model**: AI_PROVIDER_ERROR with useful messages (401→re-enter key, 429→retry, offline→AI_OFFLINE)

### ✅ Phase 3 — Storyboard (COMPLETE, v0.2.1)
- **Storyboard Studio**: episodes ▸ scenes ▸ shot strip (grid cards with 16:9 frame preview) ▸ shot editor
- **Shot metadata**: 10 framing types (Close-Up, Wide, POV, Aerial, etc.), 6 lens presets (14mm-135mm), 10 camera movements (Dolly, Tracking, Crane, etc.), duration seconds + scene runtime total
- **Real frame import**: native dialog → validated (extension + 40MB limit) → copied to `images/assets/` → registered in `assets` table → served via restricted `mirai-asset://` protocol (path-escape protection tested)
- **Orphan pruning**: replacing/clearing a frame deletes the old file if unreferenced
- **Style Bible**: art direction, lineart, shading, palette, lighting, proportions, eyes & hair, backgrounds, camera language — autosave
- **Voice lines**: real audio import per shot (wav/mp3/ogg/m4a/flac/aac/opus), inline audio player

### ✅ v0.8.0 — Subtitles, Video Gen, Render Polish, Phase 8 AI (COMPLETE)
- **Subtitle Studio**: real SRT/VTT codecs in shared (tolerant parse + writers, unit-tested), SubtitleService (CRUD/import/export to exports/), Subtitles page, live cue overlay in the Timeline preview, **render burn-in** (subtitles filter, temp .srt, verified by integration test)
- **Video generation**: OpenAIVideoProvider (sync b64 + async job-polling + download URLs, abort, friendly errors; mocked-transport tests), settings.ai.video + 'videogen' credential, aiHost.generateVideo (consistency prompt + motion direction), job ai.generateVideo, registerGeneratedVideo (real bytes → video/generated/ + shot.videoAssetId + orphan pruning), preview plays the real video (engine-owned elements, drift-corrected, effects+camera), **render uses the real video file as clip source** (trim/scale/fps)
- **Render polish**: blend modes render for overlay tracks (CSS↔ffmpeg map + tpad + blend + exact trim), animated camera opacity bakes into per-frame alpha (geq lum+alpha), effects merge fix ({} payloads no longer NaN)
- **Phase 8 AI**: ai:analyzeScreenplay / directorNotes / continuityCheck (chatJson zod-validated; continuity merges rule-based cast cross-check), ai:productionReview orchestrated 3-step job + decision log, multi-agent personas in AI Assist, AI Workflows page (visual pipeline runner)
- **Scene editor**: music/SFX/ambience assignment UI (chips + role select) feeding Build Timeline

### ✅ Phase 7 — Production Suite (COMPLETE, v0.7.0)
- **Task Board** (kanban): 5 columns (TODO/IN_PROGRESS/REVIEW/APPROVED/FINAL), drag between columns, priorities (LOW/NORMAL/HIGH/CRITICAL), entity links (SCENE/SHOT/EPISODE/CHARACTER/LOCATION/MEDIA), crew assignment
- **Crew roster**: 10 studio roles (Director, Producer, Writer, Character Designer, Background Artist, Animator, Editor, Sound Designer, Voice Actor, Reviewer); deleting a member unassigns tasks, never deletes them
- **Governed approval pipeline**: APPROVAL_PIPELINES with forward maps — REVIEW approves OR sends back to REVISION (side state, not mandatory); backwards always free; characters/locations use ASSET statuses, episodes/scenes/shots use TASK statuses; `approvals:transition` validates + persists + logs (actor + note); Character editor status select goes through the pipeline live; LOCKED/FINAL edit-warning badges
- **Audit log**: every governed transition recorded (from/to/note/actor) — Production → Approvals tab
- **Entity versioning**: snapshot/restore/diff for CHARACTER, LOCATION, SCENE (screenplay), SHOT, STYLE_BIBLE; restore auto-snapshots current state first ('auto — before restore'); field-level diffs; History modal embedded in Character + Shot editors
- **Quality Control**: 10 automated checks (scene-no-shots, shot-no-frame, shot-dialogue-no-voice, scene-no-screenplay, scene-no-timeline, episode-no-scenes, shot-frame-missing-file, media-missing-file, character-no-appearance) with ERROR/WARNING/INFO severities + fix hints
- **Production analytics**: real aggregates (episodes/scenes/shots by status, frame/voice/timeline/screenplay coverage, assets, media, tasks, approval events, crew, versions) + Dashboard progress bars
- **Status persistence fix**: creative/storyboard update paths now persist `status` (preserving current status when the input omits it — no more silent resets)

### ✅ Phase 6 — Render & Export (COMPLETE, v0.6.0) — MASTER FLOW CLOSED END-TO-END
- **sceneRenderBuilder** (pure, fully unit-tested): timeline bundle + keyframes → FFmpeg `filter_complex`
  - VIDEO: per-clip effects chain (eq/hue/gblur/vignette — 1:1 with the preview), camera via `zoompan` with piecewise expressions sampled from keyframe curves (sub-sampled bézier/easeIn/easeOut/easeInOut), `rotate` for rotation, per-track `concat`, multi-track `overlay` compositing with `colorchannelmixer` opacity, frameless shots → `color=black` segments
  - AUDIO: per-clip `atrim` (in-point) → baked `volume='expr(t)':eval=frame` (clip × CLIP automation × track volume × MIXER automation) → `pan` matrix → `adelay` placement → `amix normalize=0` → exact duration; muted/solo-excluded tracks dropped; `anullsrc` silent bed fallback
- **RenderService**: renderScene (job: `render.scene`), renderEpisode (renders scenes in order + lossless `-c copy` concat stitch; unbuilt scenes → actionable VALIDATION_ERROR; temp parts always cleaned), listOutputs/deleteOutput (sandboxed to exports/), probeDuration/probeResolution via ffprobe, shared runner with `time=` progress parsing + cooperative abort
- **Export Center** (new "Render & Export" page): 7 professional presets (YouTube 1080p/4K, TV Broadcast, Web, Cinema Master 4K, Mobile 720p, Social 9:16), PREVIEW (ultrafast/CRF 30) vs MASTER (medium/CRF 18), outputs browser (size/duration/resolution/reveal/delete, live refresh), live render progress bar
- **Render Scene button on the Timeline page** with live job percentage
- **Real-FFmpeg tests**: in-test PNG encoder (deflate+CRC32) + WAV encoder; scene with camera zoompan + voice + music renders a REAL 1920×1080 MP4 verified by ffprobe; episode stitches losslessly; guards for missing timelines
- **THE GATE PASSED**: Project → Character → Scene → Screenplay → Storyboard → Image → Voice → Music → Timeline → **Render → REAL MP4 in exports/**

### ✅ Phase 5 — Editing Suite (COMPLETE, v0.5.0)
- **Master Timeline** (per-scene, canvas 2D): adaptive ruler, real frame thumbnails, REAL audio waveforms (Web Audio decodeAudioData peaks cached per asset)
- **Build Timeline**: one click assembles shots → VIDEO/VOICE clips (sequential, real durations), scene media → MUSIC/SFX/AMBIENCE tracks; `buildFromScene` + reset
- **Clip editing**: drag-move with magnetic snapping (clip edges, markers, playhead), cross-track moves with kind-compatibility rules, no-overlap enforcement (VALIDATION_ERROR), trim L/R with real in-point math, split at playhead preserving inOffset, plain delete + ripple delete (shifts clips at/after the deleted end across ALL tracks)
- **Markers**: ruler flags, add (M), select, delete, jump prev/next (,/.)
- **Zoom**: ctrl+wheel around cursor (4–480 px/s), Fit (0)
- **REAL playback engine** (PlaybackEngine, Web Audio): `<audio>` → MediaElementSource → clipGain → trackGain → StereoPanner → master → destination; start/stop at clip boundaries, drift resync >150ms, loop toggle
- **Audio Mixer**: channel strips per audio track + Master; custom pointer-driven faders, pan, mute, solo, dB display; volume automation (MIXER keyframes) + per-clip fades (CLIP keyframes) applied live
- **Camera System**: CAMERA keyframes per shot (x, y, scale, rotation, opacity — pro ranges), sampled live into the preview transform (Ken Burns)
- **Keyframe Editor**: SVG curve view with REAL sampled path, draggable keyframe dots, per-keyframe easing (linear/easeIn/easeOut/easeInOut/**cubic bezier** with Newton+bisection solver in shared), bezier control sliders, add/delete
- **Preview compositing**: multi-video-track layer stack (track order = z), per-clip opacity, 8 CSS blend modes, effects chain (brightness/contrast/saturate/hue/blur/grayscale/vignette) — all previewable now and mapping 1:1 to FFmpeg eq/hue/gblur for Phase 6 render
- **Configurable shortcuts (full system)**: SHORTCUT_ACTIONS catalog (16 actions), DEFAULT_SHORTCUTS ⊕ overrides in AppSettings.shortcuts, normalizeCombo/prettyCombo in shared, comboFromEvent + registry + global dispatcher in renderer, rebind UI in Settings (press-to-capture, conflict detection ⚠), palette Ctrl+K configurable
- **Custom dockable panels**: Preview/Inspector+Curves tabs/Mixer/Timeline with drag splitters + visibility toggles; sizes + hidden panels persisted in settings.editing.layout
- **Orchestration** (register.ts): shot delete → deletes CAMERA keyframes; media delete → removes its clips first; track delete → MIXER + CLIP keyframe cleanup; clip delete → CLIP keyframe cleanup
- **Renderer modules**: modules/timeline/ (TimelinePage, TimelineCanvas, PlaybackEngine, PreviewStage, MixerPanel, KeyframeEditor, InspectorPanel, waveform)

### ✅ Phase 4 — Media & Render (COMPLETE, v0.4.0)
- **Media Library**: Music / SFX / Ambience — import real audio files, categorize, assign to scenes with roles (Opening, Ending, Background, Insert, Battle, Romance, Tension), volume control, inline audio player, tags, search, reveal, delete
- **Render Engine (FFmpeg)**: renders a single shot to REAL MP4:
  - Frame image looped for shot's duration + voice audio
  - H.264 with `-tune animation` (same setting real anime studios use)
  - AAC 192kbps if voice exists, silent otherwise
  - 1920×1080, `yuv420p`, `+faststart`
  - Output in `exports/` folder
  - Job-based with real-time FFmpeg progress parsing from stderr
  - Render button on every shot (disabled if FFmpeg not found)
- **Migrations**: 0006_media_library (media_tracks + scene_media tables)

### ✅ Cross-cutting
- **Prompt Library**: 12 built-in professional manga/anime prompts (manga panels, character sheets, keyframes, style anchors, negatives, story tools), user CRUD, tags, copy, "Use in Assist"
- **Packaging**: .deb (Section: graphics) + AppImage, boot-tested before release
- **Website**: https://yuaberry.github.io/mirai-studio (sakura particles, animated gradient, genre marquee)
- **GitHub**: https://github.com/yuaberry/mirai-studio (public, releases v0.2.1/v0.3.0/v0.4.0)

---

## 7. WHAT REMAINS (by phase)

### Phase 4 — Media (COMPLETE in v0.8.0)
- [x] Subtitle Studio: SRT/VTT import/export + render burn-in — DONE
- [x] Video generation provider contract + shot attach + preview + render — DONE
- [x] Music assignment UI on scene editor — DONE
- [ ] ASS (Advanced SubStation) format support — future polish

### Phase 6 — Render (DONE in v0.6.0 — remaining polish)
- [x] Timeline → MP4 with camera/effects/audio mixdown — DONE (sceneRenderBuilder + FFmpeg)
- [x] Episode render (lossless concat stitch) — DONE
- [x] Export Center with professional presets — DONE
- [x] Preview vs Master quality — DONE
- [x] Render queue (JobQueue integration, progress, cancel) — DONE
- [ ] Animated camera opacity curves in render (currently constant/fade-style only — zoompan/rotate fully animated)
- [ ] Blend modes in render (preview-only for now — `blend` filter needs matched streams)
- [ ] Render subtitle tracks (needs Phase 4 subtitle studio first)
- [ ] Bundled FFmpeg (LGPL build licensing decision) — currently requires system FFmpeg with clear guidance
- [x] **GATE: master flow END-TO-END** — PASSED (smoke step 31 renders a real 7s MP4)

### Phase 7 — Production (DONE in v0.7.0 — remaining polish)
- [x] Task board — DONE (kanban, drag, priorities, links, crew)
- [x] Approval pipeline with audit — DONE (governed transitions + log)
- [x] Entity versioning — DONE (snapshot/restore/diff, safety snapshots)
- [x] QC automated checks — DONE (10 checks with fix hints)
- [x] Production analytics dashboard — DONE
- [x] Team roster — DONE (crew + assignment + audit actors)
- [ ] Permission ENFORCEMENT per role (needs multi-user/cloud — Phase 9)
- [ ] Task due dates + calendar view (future polish)

### Phase 8 — Advanced AI
- [ ] AI Director: analyzes narrative, composition, rhythm, emotion, camera — suggests changes
- [ ] Continuity Engine: detects wrong costume, impossible location, temporal inconsistencies, etc.
- [ ] Multi-agent orchestration (Director, Writer, Character Designer, Background Artist, etc.)
- [ ] Visual Workflow Builder: connected nodes (Input → Writer → Continuity → Storyboard → Image Gen → Video Gen → Voice → Render)
- [ ] AI Screenplay Analyzer: pacing, dialogue quality, repetition, character voice consistency

### Phase 9 — Extensibility
- [ ] Plugin API with permission model (READ, SUGGEST, EDIT, CREATE, DELETE, EXPORT)
- [ ] Provider SDK for community adapters
- [ ] Marketplace foundation

---

## 8. KEY ARCHITECTURAL DECISIONS (ADRs)

| # | Decision | Reason |
|---|---|---|
| D01 | Electron | TS backend, safeStorage, native modules, worker_threads |
| D02 | better-sqlite3 + versioned SQL migrations | Sync, fast, portable, one runner for App + Project DBs |
| D03 | Tests under Electron's Node (`ELECTRON_RUN_AS_NODE=1`) | Eliminates ABI drift between test and runtime |
| D04 | Own LoggerService (not pino) | Ring buffer for Diagnostics + sync file writes (async stream racing rename loses files) |
| D05 | Typed IPC contract table | zod validates both directions; renderer client fully typed |
| D06 | Credentials are write-only from UI | No `credentials:get` IPC channel exists |
| D07 | Jobs persist per-project DB | Portability + scoped recovery; open() auto-recovers PAUSED |
| D08 | Cancelled RUNNING jobs → CANCELLED, never FAILED/retried | Caught by tests, spec §8 |
| D09 | AI transport is injected FetchLike port | Fully testable offline; main wires `global fetch` |
| D10 | Built-in prompts use deterministic ULID-shaped ids (sha256→Crockford) | Idempotent seeding + schema-valid |
| D11 | npmRebuild: false in packaging | Native module compiled by rebuild:native; builder ships it (asarUnpack) |
| D12 | External backup after every milestone | A workspace loss incident (v0.1.0) taught us: code outside git needs a tarball |
| D13 | mirai-asset:// custom protocol | Restricted scheme (asset id → validated path inside project); no renderer path access |
| D14 | Frames are imported files, not generated placeholders | Real pipeline (validate → copy → registry → prune orphans); AI image gen separate |
| D15 | Prompt Library lives in the project DB (per-project) | Travels with backups/duplicates; global library = Phase 9 marketplace |

---

## 9. KNOWN ISSUES & LESSONS LEARNED

1. **bindings module**: `better-sqlite3` requires `bindings` and `file-uri-to-path` at runtime — bun hoists them to the root, but the packaged app only picks up app-level `node_modules`. **Always declare runtime deps explicitly in `apps/desktop/package.json` `dependencies`.**
2. **Async stream racing rename**: `createWriteStream` + `renameSync` in the logger caused silent file loss (ENOENT swallowed by catch). Fix: use synchronous `appendFileSync`.
3. **Job cancellation**: RUNNING jobs that throw after being cancelled must become CANCELLED, not FAILED/retried.
4. **zod nested defaults**: `.default({})` needed on nested object schemas for `parse({})` to work.
5. **Working tree vs git**: `rm -rf` on the working tree to create a gh-pages branch destroyed `node_modules` (untracked). `git checkout` restored tracked files but not node_modules. **Always use orphan branches for gh-pages or be very careful with `rm -rf`.**
6. **gh-pages push**: The gh-pages branch accumulated 1.6GB of garbage. Fix: create a clean orphan branch with just the 4 website files and force-push.
7. **BuildImagePrompt**: The Style Bible step in the smoke test must run BEFORE the image pipeline step (dependency order matters in smoke tests).
8. **gh-pages from a monorepo**: NEVER `git checkout main -- .` on the gh-pages branch — it pulls the whole tree into the orphan branch and bloats pushes past GitHub limits (1.6 GB → HTTP 408 rejected). Always create a clean orphan branch containing ONLY the website files, then force-push to `gh-pages`.
9. **String replace pitfalls**: scripted bulk edits replacing `ctx.` with `tctx.` also match inside `tctx.` → `ttctx.`. Also zod `.default()` fields: service methods should accept `z.input<T>` (defaults optional), not `z.infer<T>`.
10. **better-sqlite3 ABI**: after ANY `bun install` (node_modules wipe), run `node apps/desktop/node_modules/electron/install.js` + `bunx @electron/rebuild -f -w better-sqlite3` (inside apps/desktop; the root script now does this). Symptom if skipped: `tsc: command not found` or native module ABI mismatch.
11. **Smoke context lifetime**: the ARCHIVE step closes the project — later steps must re-open (`projects.open(summary.path)`) before touching project services.
12. **TanStack + settings**: `useUpdateSettings` takes the AppSettings object directly (not `{settings}`); Modal requires `open` prop and `width` is a CSS class string (e.g. `max-w-lg`).
13. **Template-literal interpolation braces**: `${x ?? '...}'}` — a `}` inside a string inside an interpolation closes the interpolation early and corrupts the line. Extract such strings to constants (`zxCenter`).
14. **Appending code to a class file**: `cat >>` lands AFTER the class-closing `}` — methods end up outside the class. Always re-check the brace balance.
15. **Real-media smoke fixtures**: FFmpeg only decodes REAL files. The smoke now carries minimal in-script encoders (PNG via deflate+CRC32, WAV via RIFF headers) — reuse them for any future media step; never feed `Buffer.alloc` fakes into render tests.
16. **Rendered smoke state**: scene media assigned in earlier smoke steps persists in the timeline — before rendering in a test, swap fake-byte media assignments for real files (removeFromScene + assign real WAV).
17. **Never lint-fix imports blindly**: removing an "unused" import that a zod object references at module scope compiles away in the bundler as a runtime ReferenceError (`zTaskStatus is not defined`) before typecheck catches it in a stale run. Always re-run typecheck immediately after every lint change.
18. **Zod input defaults clobber**: `updateX(input)` with `.default()` fields OVERWRITES omitted fields (role → SUPPORTING). Updates must preserve current values (`parsed.status ?? existing.status`) — never blind-default on update paths.
19. **Linear pipelines are wrong for approvals**: REVISION is a side state (REVIEW approves forward or returns to REVISION), not a mandatory step. Model pipelines as forward-transition MAPS, not ordered arrays.
20. **FFmpeg filter facts (tested)**: tpad modes are `add|clone` (NOT `color` — the color is a separate option); `geq` REQUIRES a luma/rgb expression even for alpha-only edits (`lum='lum(X,Y)'` passthrough) and reads planes via `lum(X,Y)`/`alpha(X,Y)` functions, NOT bare `r`/`alpha` variables; subtitle paths need `\:` and `\'` escaping.
21. **`split(/\s+/)` on strings with leading spaces** yields an empty first element — `.trim()` before splitting (VTT to-timecode parse bug).
22. **DB rows with partial JSON** (`'{}'` literals) must be merged over defaults when parsed — naive field access produced `NaN` filter expressions that only surfaced at FFmpeg runtime. The FFmpeg integration tests are the gate that catches these.
23. **Workspace `exports` maps block subpaths**: `@mirai/core/src/...` imports silently vanish in bundling. Export new symbols from the package index instead.

---

## 10. HOW TO RUN & BUILD

### Prerequisites
- Bun ≥ 1.1
- Node ≥ 18 (for electron installer script)
- Build tools (gcc, g++, make, python3) for native module rebuild
- FFmpeg on system PATH (for render)

### Setup from scratch
```bash
bun install
node apps/desktop/node_modules/electron/install.js   # if electron dist/ missing
bun run rebuild:native                                # compile better-sqlite3 for Electron
bun run verify                                         # full gate: typecheck + tests + build + smoke
bun run dev                                            # launch with HMR
```

### Key scripts
| Script | What it does |
|---|---|
| `bun run verify` | Typecheck → tests → build → 25-step E2E smoke |
| `bun run dev` | Electron + Vite HMR |
| `bun run build` | Production build (out/) |
| `bun run package:linux` | .deb + AppImage in release/ |
| `bun run rebuild:native` | Compile better-sqlite3 for Electron ABI |
| `bun run test` | Shared + AI tests |
| `bun run test:core` | Core tests (under Electron's Node for ABI) |
| `bun run lint` | ESLint (flat config) |
| `bun run icons` | Regenerate icon set from build/icon.svg |

### Packaging
```bash
bun run rebuild:native
bun run package:linux    # → apps/desktop/release/mirai-studio_X.Y.Z_amd64.deb + AppImage
# Boot-test the packaged binary:
timeout 30 apps/desktop/release/linux-unpacked/mirai-studio
```

---

## 11. VERSION HISTORY

| Version | Phase | Key additions |
|---|---|---|
| v0.1.0 | Phase 0 | Foundation: app shell, IPC, SQLite, projects, jobs, logger |
| v0.2.0 | Phase 1 + Phase 2 start | Creative Core (Bible/Characters/Locations/Episodes/Scenes), OpenRouter streaming AI Assist, Prompt Library, .deb packaging |
| v0.2.1 | Phase 3 | Storyboard Studio, real frames via mirai-asset://, Style Bible |
| v0.3.0 | Phase 2 complete + Phase 4 start | Scene Writer agent (human-in-the-loop), NVIDIA NIM (GLM 5.3) provider, Generate Frame with studio consistency, voice lines, full anime genre taxonomy (~55), providers UI |
| v0.4.0 | Phase 4 | Media Library (Music/SFX/Ambience + scene assignment), Render Engine (FFmpeg shot → MP4 H.264 animation-tuned) |
| v0.5.0 | Phase 5 | Master Timeline (canvas, real waveforms/thumbnails), clip editing (snap/trim/split/ripple), REAL Web Audio mixer + automation, Camera System + Keyframe Editor (linear/ease/bézier), preview compositing (blend/effects/vignette), configurable shortcuts + rebind UI, custom dockable panels |
| v0.6.0 | Phase 6 | Timeline → REAL MP4 (sceneRenderBuilder: zoompan camera, eq/hue/gblur effects, amix audio mixdown with automation), episode lossless stitching, Export Center (7 presets, PREVIEW/MASTER), outputs browser, master flow CLOSED end-to-end |
| v0.7.0 | Phase 7 | Production suite: kanban Task Board + crew, governed approval pipeline with audit log, entity versioning (snapshot/restore/diff with safety snapshots), QC (10 checks), production analytics dashboard |
| v0.8.0 | Phase 4 wrap-up + Render polish + Phase 8 | Subtitle Studio (SRT/VTT + preview overlay + render burn-in), video generation provider (sync+polling) with real shot attach/preview/render, blend modes + animated opacity in render, AI Screenplay Analysis + Continuity Engine + AI Director + orchestrated production review + personas + Workflows page |

---

## 12. CURRENT STATE (as of this file's creation)

- **Repo**: https://github.com/yuaberry/mirai-studio (public, main branch)
- **Website**: https://yuaberry.github.io/mirai-studio (v0.4.0)
- **Latest release**: v0.4.0 (GitHub Releases: .deb + AppImage)
- **All tests**: 151 passing (15 shared + 27 AI incl. 4 video-provider + 109 core incl. 8 subtitles + 11 render)
- **Smoke**: 40/40 steps passing (5 new v0.8 steps)
- **Lint**: 0 errors, 0 warnings
- **Typecheck**: 0 errors (4 workspaces)
- **IPC channels**: 140 contracts, 141 handlers
- **Migrations**: 0001-0009 (App + Project)
- **Latest release**: v0.8.0 (.deb + AppImage, boot-tested)
- **Website**: https://yuaberry.github.io/mirai-studio (v0.8.0)
- **Backup**: `/home/llinux/mirai-studio-backup-v0.8.0.tar.gz`

---

## 13. NEXT IMMEDIATE ACTIONS

1. **Phase 9 — Extensibility** (the last roadmap phase): plugin API with permission model, provider SDK, marketplace foundation.
2. **Polish backlog**: ASS subtitles, drag-and-drop workflow builder, bundled FFmpeg, undo/redo.
3. **Optional**: multi-user/cloud sync.

---

## 14. RULES FOR THE NEXT SESSION

When continuing from this file after context compaction:

1. **Read this file completely** before doing anything.
2. **Run `bun run verify`** first to confirm everything is still green.
3. **Check `git log --oneline -5`** to see where we are.
4. **Check `git status`** — working tree should be clean.
5. **Never destroy working code** — always `git status` before destructive operations.
6. **Always run verify after changes** — this is the quality gate.
7. **The user speaks Portuguese (pt-BR)** — respond in their language.
8. **When the user says "crie o arquivo Plan.md"** — regenerate this file with updated state and commit to GitHub.
9. **Priority order**: FUNCTIONALITY > ARCHITECTURE > RELIABILITY > PERFORMANCE > UX > AESTHETIC.
10. **Never create fake buttons or mock data** — if a feature can't be real yet, create the contract + adapter + document the limitation.
11. **Back up after every milestone**: `tar -czf mirai-studio-backup-vX.Y.Z.tar.gz --exclude=node_modules mirai-studio/`
12. **The AI generation must ALWAYS bake in Style Bible + shot camera + scene context** for studio-quality consistency — this is the user's #1 quality requirement.

---

*Last updated: v0.8.0 — Phases 0-8 ALL delivered + Phase 4/6 wrap-ups complete. Only Phase 9 (Extensibility) + polish remain on the original roadmap.*
*Repository: https://github.com/yuaberry/mirai-studio*
*Website: https://yuaberry.github.io/mirai-studio*
