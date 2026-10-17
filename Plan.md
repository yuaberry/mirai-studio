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

**POSITIONING (v0.10)**: The app is a STORYTELLING STUDIO, not an adult-content generator. Mature Content Mode (Pro) is a toolset for adult-rated narratives with the adults-only policy enforced in code. SFW is the default. This position is stated in the activation conscientization, on the website Pro section, and in this file — keep it consistent in all future work.

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
| App 0002_app_kv | `app_kv` (plugin enable state + future app-level kv) |
| 0010_blend_files | `shots.blend_asset_id` |

**Key design decisions**:
- IDs are ULIDs (26 chars Crockford base32) — never autoincrement
- Timestamps: ISO-8601 strings
- JSON payloads stored as TEXT
- Foreign keys: ON with CASCADE for children, SET NULL for optional refs
- WAL mode, busy_timeout 5000ms

---

## 5. IPC CONTRACTS (153 channels)

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
- **plugins (Phase 9):** 5 channels — plugins:list/setEnabled/installFromFolder/delete/runCommand
- **v0.10:** 7 channels — license:activate/status, content:setMature, blender:status/attachBlend/renderShot, ai:autoproduce
- **v0.12:** +1 — ai:generateAllFrames (batch keyframes per scene)
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

### ✅ v0.10.0 — Mature Mode (Pro), Blender bridge, Producer Agent (COMPLETE)
- **Licensing**: offline Ed25519-signed keys (LicenseService, production public key embedded; private key OFF-repo at `/home/llinux/mirai-studio-private`-style path — mint with `scripts/licensegen.mjs`); strict payload (v/holder/tier/features/iat/exp); tests use runtime keypairs through the SAME code path
- **Mature Content Mode**: gated by Pro license with the `mature` feature + 18+ conscientization modal (story-first positioning, legal + provider-ToS responsibility, hard rules displayed); server-side `content:setMature` enforces license + ageConfirmed; mature genres (Hentai/Erotica/Adult Drama) hidden until enabled (`filterGenres`)
- **Adults-only policy IN CODE** (MaturePolicy): explicit generation requires every cast character explicitly adult (`assessAge` parses numbers + keywords; minors and ambiguous ages throw POLICY_VIOLATION); enforced in generateFrame/generateVideo; `maturePipelineActive` = setting AND project rated 18+; mature contract line in prompts only then
- **Blender bridge**: attach .blend (validated ≤500MB, project-stored, orphan-pruned) → headless render job (`blender -b … -F FFMPEG`) → MP4 becomes the shot's real video (preview + render seamless); graceful detect; shot-editor UI buttons
- **Producer Agent** (`ai.autoproduce` job + Producer page): idea → bible draft (NEVER overwrites the author) → cast design (name-deduped) → episode/scene plan (locations + cast links) → screenplays (Scene Writer) → shots (enum-validated) → optional keyframes → timelines; live step progress + summary; smoke-verified END-TO-END with mocked transport against a real project
- New error codes: POLICY_VIOLATION, LICENSE_INVALID

### ✅ Phase 9 — Extensibility (COMPLETE, v0.9.0) — THE ORIGINAL ROADMAP IS DONE
- **Plugin system**: strict PluginManifest (zod: slug ids, semver, namespaced commands, permissions), folder install (idempotent reinstall), delete; invalid manifests listed but LOCKED; two REAL bundled examples (Starter Commands, Manga Prompt Pack)
- **Permission model** (READ/SUGGEST/EDIT/CREATE/DELETE/EXPORT): enforced at every `mirai.*` call in the PluginHost — smoke-verified against a real open project (SUGGEST-only plugin denied READ; granted variant returns real data)
- **PluginHost** (main): loads user-installed index.js (CommonJS) with a strictly scoped API (project summary via READ, scene render via EXPORT — never raw IPC, credentials, paths or DB handles)
- **Provider SDK**: plugins declare chat/image/video endpoints; the Plugins page APPLIES them into Settings (user owns the key) — real for all three provider kinds
- **Marketplace foundation**: CURATED_MARKETPLACE curated specs registry + docs/plugins (README + MANIFEST reference + publishing guide)
- **Deep integration**: plugin commands in the Command Palette; plugin prompts in the Prompt Library (badge); plugin presets in the Export Center (real render params)
- **Timeline undo/redo** (polish): inverse-op stacks for move/trim/split/delete/ripple (restores shifted clips)/markers; Ctrl+Z / Ctrl+Shift+Z in the shortcut catalog; invalid forward ops pop their entry

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

## 7. WHAT REMAINS (true state as of v0.13.0)

Everything from the original roadmap phases is DONE. What remains is
cloud-only infrastructure — explicitly out of scope for local-first v1:

- [ ] Permission enforcement across MULTI-USER teams (needs cloud sync + auth)
- [ ] Remote marketplace install with hosted registry (needs hosting infra)
- [ ] Bundled FFmpeg for Windows/macOS builds (linux GPL static done; Win/mac
      equivalents: gyan.dev full builds / everbuild — pick at port time and keep
      shipping the license text + source pointer)

### Completed in v0.13.1 (quality pass)
- [x] QC: task-overdue + scene-subtitle-overlap checks (with tests)
- [x] i18n: ALL page headers + Settings General wired (pt-BR surface complete)
- [x] Overdue badge on task cards
- [x] fetch-ffmpeg platform-aware (win/mac URLs config-ready, marked UNTESTED)

### Completed in v0.13.0 (the last roadmap gaps)
- [x] ASS (Advanced SubStation) subtitles — codec in shared, service + UI
- [x] Task due dates + calendar view — migration 0011 + TasksTab Calendar
- [x] Bundled FFmpeg (GPL static, libx264 — separate-process use, license ships in-archive) — no system FFmpeg needed anymore
- [x] Visual Workflow Builder node editing — drag-drop canvas in Workflows

### Historical note (was STALE before v0.13.0)
Phase 8 AI (Director notes, Continuity Engine, Screenplay Analyzer, personas,
production review orchestration, workflows runner) and render polish (animated
camera opacity curves, blend-mode compositing) shipped in v0.8.0 — but this
file's old WHAT-REMAINS checklist still listed them. Lesson: when finishing a
phase, update the checklist in the same session.

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
24. **Enable/disable maps default to the SAFE value**: an "absent = enabled" map combined with `delete on enable` inverts the default and breaks round-trips (plugin state test caught it). Store the actual boolean; absence = disabled.
25. **Python-scripted edits miss as often as they hit**: three of this session's import patches didn't match the real file (different context lines) and silently no-op'd. ALWAYS grep the result immediately after every scripted edit.
26. **`import type` is erased, runtime `require()` of user code is fine in main**: the PluginHost loads user plugins via CommonJS require exactly like editor extensions do — the scoped API + permission gates are the security boundary, not module loading.
27. **Sync-throwing policy functions**: never wrap a synchronous-throwing validator in promise-style try/catch scaffolding in smoke tests — assertExplicitCastAllowed throws synchronously; use a plain try/catch.
28. **The Producer must respect the author**: autoproduce skips bible drafting when a premise exists and dedupes characters by name — tests must assert that BEHAVIOR (skip + dedupe), not blind counts.
29. **Never embed the license PRIVATE key anywhere in the repo** — tests generate runtime Ed25519 keypairs and inject the public key; the production pair lives only on the dev machine (private: `mirai-license-private.pem` next to the backups).
30. **spawnSync detect timeouts (5s) can be transient under load** — a "FFmpeg not installed" smoke skip that comes and comes is system load, not a bug; re-run before debugging code.
31. **Website link rot is silent**: the download hrefs still pointed at v0.2.1 filenames after eight version bumps (the visible version text was updated, the filenames weren't). Always verify BOTH the version label AND the asset filenames in hrefs when bumping versions.
32. **Check the CSS variable vocabulary before writing new styles**: the site uses `--raise/--panel/--bg/--accent`, not `--bg-raise/--pink` — appending a block with wrong var names silently renders as broken colors. Grep `:root` first.
33. **Producer/dedupe semantics must be tested as BEHAVIOR**: autoproduce skips existing premises and dedupes character names by design — assertions that count blind totals fail; assert the skip + dedupe happened instead.
34. **Native `<select>` popups ignore the app theme on Linux**: without `color-scheme: dark` on html + explicit `option { background/color }`, dropdown lists render system-white and become unreadable. Test select-heavy screens (Settings, New Project) on every styling change.
35. **The whole UI is rem-based — the root font-size is the responsiveness knob**: setting `document.documentElement.style.fontSize` (density 14/16px × uiScale) rescales EVERYTHING cleanly; no per-page responsive work needed.
36. **User-reported UI scale issues** = density/uiScale settings; the default (comfortable × 100%) may look oversized on small/laptop screens — direct users to Settings → General → UI scale.
37. **Bump tests with tier upgrades**: when changing encoding defaults (CRF/preset), builder unit tests assert the OLD values — update expectations in the same commit (the CINEMA integration test catches what unit tests miss).
38. **image-to-video is the consistency unlock**: passing the storyboard keyframe as `input_reference` keeps character design locked from board to clip — default ON; text-only fallback when the shot has no frame.
39. **NEVER hardcode window dimensions**: a fixed 1440×900 BrowserWindow was literally larger than laptop screens (1366×768) — the user's "app is off my screen" report. ALWAYS clamp to `screen.getPrimaryDisplay().workAreaSize` and maximize on small displays. Same class of bug: modals must be `max-h-[calc(100vh-…)] overflow-y-auto`, never assume viewport height.
40b. **Solid-color clips compress brutally**: a 4K CRF-14 render of a solid-color frame can be < 20KB — size floors in render tests must account for content trivially compressible (8KB floor), not bitrate expectations.
41. **"Still too big" reports usually mean an OLD BUILD**: screen fixes land only after the user installs the new release — always tell them WHICH version to download, and make the fix self-acting (autoFit) so no setting hunt is needed. When clamping windows, ALSO hard-clamp after ready-to-show (WMs restore session sizes) and use useContentSize (title bars steal height otherwise).
42. **Genre taxonomy = TWO lists**: ANIME_GENRES (genres.ts) holds the tags; MATURE_GENRES (license.ts) gates the adult block via filterGenres — add mature tags to BOTH or the filter and QC classification drift. Currently 293/41.
44. **The masquerade corruption**: a `}` silently replaced by `"` inside JSX (`onClick={onClose"`) breaks tsc AND esbuild at a line that LOOKS perfectly clean in sed/cat -A output — because eyes read what they expect. NEVER verify JSX by eyeball: run `bunx esbuild <file> --outfile=/dev/null --loader:.tsx=tsx` (2s) after every scripted edit batch. During the hunt, git stash/checkout/apply cycles MUTATED the file further — after ANY restore cycle, re-verify the whole file parses before debugging content.
45. **Python heredoc edits on TSX are radioactive**: two silent corruptions in ONE session (SubtitlesPage + ProductionPage), both in re-emitted JSX blocks. Rule: python is fine for .ts/.json/yaml anchors; for TSX use the Edit tool (exact oldString matching fails loudly, no escaping layers).
46. **`__dirname` depth math**: from packages/core/src/render, THREE `..` = packages/, not the repo root — probe with a temp test printing computed paths instead of assuming; vitest provides __dirname per real file location.
54. **Import cycles crash CJS boot at runtime, not at typecheck**: dossier.ts ⇄ project.ts (PROJECT_MEDIUMS vs CONTENT_RATINGS) — typecheck GREEN, vitest GREEN, smoke GREEN, and the PACKAGED APP died with 'Cannot access before initialization'. The boot test (timeout 20 + grep Uncaught) is the last line of defense — NEVER skip it. Rule: shared entities keep a strict hierarchy (dossier imports from project, never the reverse).
61. **Local green ≠ CI green (ABI)**: every locally-boot-fine release shipped BROKEN from CI because node_modules was locally rebuilt against Electron's ABI once — CI installs fresh (Node ABI) and npmRebuild:false packs it as-is. ANY native module project MUST run its rebuild step inside every CI job that packages. ACCEPTANCE TEST for packaged apps: dpkg-deb -x (no root) + ELECTRON_RUN_AS_NODE require of the packed .node — ABI_FAIL/ABI_OK in one line; require the .node FILE directly (requiring the package hits 'bindings' resolution through the asar and fails misleadingly).
62. **The publish job needs the release to EXIST**: gh release upload <tag> fails when the release hasn't been created yet — create the release (can be local-artifacts-only) before the CI publish step, or give publish a 'gh release create || true' first step. Also: gh run rerun --failed may print 'cannot be rerun' yet work — verify conclusions after.
58. **electron-builder rpm is a 3-vocabulary minefield** (6 CI runs): (a) rpm without artifactName uses the package name "@mirai/desktop" — the SLASH creates a phantom directory and fpm dies; (b) RPM spec names cannot contain SPACES — productName 'Mirai Studio' lands raw in the spec; fix: rpm.packageName: mirai-studio; (c) compression: electron-builder rewrites ANY xz to xzmt (threaded) which Ubuntu rpmbuild rejects; the schema enum is gz|bzip2|xz|lzo, fpm's vocabulary is none|xz|xzmt|gzip|bzip2 — bzip2 is the ONLY value valid in all three layers; (d) inserting a YAML block by matching a PREFIX line dropped it INSIDE another target's properties (deb's priority leaked into rpm and broke the GLOBAL schema on every platform). LESSON: when a config edit breaks N unrelated jobs, suspect YOUR config, not the runners — the schema error named the exact property.
59. **Workflow tag-trigger chicken-and-egg**: a workflow file introduced IN the tagged commit does not fire on that tag push (GitHub registers triggers from existing workflows) — dispatch manually via workflow_dispatch --ref <tag> the first time; future tags fire normally. Moving a tag after creating its release: git tag -f + push --force refs/tags/<tag> — CI publish uses gh release upload --clobber so re-attaching works.
60. **Never guess download URLs**: the osxexperts path I invented 404'd on CI — verify asset names via the GitHub API (gh api repos/<owner>/<repo>/releases/latest --jq '.assets[].name') and curl -sI the raw URL BEFORE shipping them; eugeneware/ffmpeg-static + joshwnj/ffprobe-static are the verified macOS binary sources (direct download branch needs mkdir + chmod 755 — writeFileSync strips the exec bit).
56. **Focus thieves in modals**: an effect with deps [open, onClose] + ref.current?.focus() + an INLINE onClose lambda = the dialog steals focus from inputs on every keystroke — 'user types one letter, typing disappears'. Rules: (a) focus-on-open must depend on [open] ONLY; (b) never pass inline lambdas across components for effect deps — memoize; (c) PROVE UI bugs against the PACKAGED app with CDP (Runtime.evaluate + mark-the-node + real KeyboardEvents) — fresh-profile testing missed this because it is locale/state dependent ('Novo Projeto' broke the first probe regex).
57. **pkill -f self-match hangs the shell**: pkill -f mirai-studio matches the persistent shell's own command line → kills its own process group → tool calls die silently. Use pgrep -x + kill by PID.
55. **Silent python replaces again (twice in one session)**: (a) 'fixed typo' printed while the m.index+m.index typo stayed (quote-style mismatch in the pattern); (b) 'ok' printed while ctx.root stayed (projectCtx had already become ctx). ALWAYS assert `old in s` before s.replace in scripted edits, and grep the RESULT — never trust the print.
53. **git add -A swept a secret**: the license receipt (MIRAI-STUDIO-PRO-KEY.txt) lived in the repo root and was committed in v0.13.0 by an add -A — publicly leaking the user's Pro key for 3 releases. Response: filter-branch purge of all history (+ tag re-creation + force-push, verified 404 on raw.githubusercontent), key ROTATED (new 10-year key in /home/llinux/MIRAI-STUDIO-PRO-KEY.txt, holder 'rotated 2026-10'), receipt moved outside the repo. RULE: run git status BEFORE every add -A and name files explicitly when anything sensitive is near the worktree; filter-branch deletes local tags (recreate + force-push the rewritten ones).
50. **Backticks in bash heredocs are radioactive**: a backtick-quoted word inside a python heredoc string ran as a command substitution (the commit message lost the word "content" — harmless but real). Use plain words in strings inside heredocs. Verify the rendered result (git log --format=%B) after any scripted commit.
51. **cmdk 0.2 → 1.x broke Dialog semantics**: overlay/content are now SIBLINGS — overlay classes no longer center the content; the content needs its own fixed positioning + z-index (user saw a black screen). When upgrading UI libs, re-check every customization point against the new DOM shape.
52. **Settings full-object writes clobber**: any writer that spreads a cached object over shared settings can wipe concurrent fields (license!). Architecture fix beats merge fix: the patch schema makes destructive writes UNEXPRESSIBLE (omitted field), which survives every stale-cache race. Section granularity + dedicated handlers per privileged section.
49. **Dictionary keys silently duplicate**: adding a key that already exists = TS1117 (lucky) — but the SAME key added twice in one dict only errors at typecheck; grep the dict for the key before adding ('Episodes' duplicated within one session). Translation wiring: prefer the `<T k>` component for static JSX — zero hook surgery per page, key falls back to English automatically.
48. **Verify the LICENSE you actually bundled**: 'download the LGPL build' → the tarball ships GPLv3.txt because libx264 (needed for H.264 encoding!) is GPL — LGPL FFmpeg can't encode H.264. The legal posture is separate-process invocation + shipping the license + source pointer. NEVER write licensing claims in docs/release notes without checking the tarball contents first.
47. **ELECTRON_RUN_AS_NODE still has process.resourcesPath** (electron dist resources) — resource resolvers must try ALL candidate dirs (asar-unpacked, direct, dev repo), never return on the first dir found.
43. **Invisible scrollbars on dark UIs**: #2a3040 on #0a0c10 is invisible to many users — thumbs need ~#4a5478 minimum, with hover/active states; test scroll containers visually on every theme change.
40. **i18n with English-source keys** (`t(locale, 'Project Hub')`): wiring is a one-line wrap per string; the dictionary lives in `lib/i18n.ts`; no code-splitting of translations needed. JSX replace pitfalls: `placeholder={x ?? tr('…')}` is valid, but sed-style replaces inside JSX braces produce nested quotes — always re-typecheck immediately after scripted label swaps.

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
| v0.9.0 | Phase 9 | Plugin system (strict manifests, enforced permissions, bundled examples), Provider SDK (declarative, user-applied), marketplace foundation, palette/prompt/preset deep integration, timeline undo/redo — ROADMAP COMPLETE |
| v0.10.0 | Pro features | Mature Content Mode (Ed25519 license keys, conscientization, adults-only enforcement in code, mature genres), Blender bridge (attach .blend → headless render → shot video), Producer Agent (idea → full episode end-to-end) |
| v0.10.1 | Polish | Website professional redesign (CSS app mockup, producer terminal, 12-card studio grid, full pipeline, Pro section, changelog; FIXED broken v0.2.1 download links), Hub capabilities strip, header genre/rating chips + Produce Episode CTA, sidebar version footer, richer EmptyStates, ambient gradients |
| v0.17.0 | CI ABI fix + themes + polish | CRITICAL: CI-built .deb/.exe/.dmg opened a window and died at bootstrap — better_sqlite3 compiled for NODE's ABI (workflow never ran rebuild:native; proven by dpkg-deb -x + ELECTRON_RUN_AS_NODE require of the packaged .node: v0.16.0 ABI_FAIL, v0.17.0 ABI_OK); rebuild:native added to all 3 desktop CI jobs. THEMES: appearance.theme enum (dark/black/light/sakura/custom) + customAccent #rrggbb; tokens.css [data-theme] var swaps (light flips color-scheme too); AppShell applies theme + accent overrides (accent-2/3 derive via color-mix); Settings picker with live-preview swatch cards + color input; schema regression test. VISUAL POLISH (global.css, all themes): panel depth, button press feedback, :focus-visible ring, brand ::selection, sliding sidebar indicator, input focus lift, deeper modal stage. 194 tests (settings 11), CI 5 jobs green, all six artifacts re-published |
| v0.16.0 | Multi-platform + mobile | GitHub Actions release workflow (.github/workflows/release.yml, tag-triggered + workflow_dispatch): linux (.deb+.AppImage+.rpm), windows (.exe NSIS, unsigned), macos (.dmg arm64, unsigned), android (companion APK), publish job attaches artifacts to the release; fetch-ffmpeg.mjs real per-platform (linux tar.xz / win32 gyan zip / darwin DIRECT binaries from eugeneware/ffmpeg-static b6.1.1 + joshwnj/ffprobe-static master — VERIFIED via API, chmod +x, mkdir in direct branch); ffmpegBin tries .exe names on win32; apps/mobile = Capacitor+Vite+React Android companion (dossier .txt reader, project .zip reader via pako zip parser, manifest fallback, mobile dark UI); author email added to app package.json (deb/rpm maintainer); ALL SIX artifacts shipped: apk 3.8MB, deb 119MB, arm64.dmg 148MB, x64-setup.exe 141MB, AppImage 171MB, rpm 154MB — CI green on run 7 after a 6-run debugging saga (see lessons 58-59) |
| v0.15.1 | Typing focus fix | CRITICAL: New Project typing died after one keystroke — Modal useEffect deps [open, onClose] with an inline lambda onClose re-ran focus on EVERY keystroke; the dialog DIV stole focus from the input (CDP-proven: sameNode true, activeTag DIV). Fix: focus contract — dialog focuses ONCE on open-transition; handleClose memoized in NewProjectModal; auto-reopen cancels when the modal is open. Evidence: before focusOnInput false ×3 keys, after true ×3 ('Sak') |
| v0.15.0 | Notes import + Project Dossier | NotesImportService (dependency-free readers: txt/md/csv/json, docx/odt zip+XML, pdf streams zlib+raw, zip stored+deflate 3-deep; honest guards, caps, skip report; 8 tests with in-test zip/pdf WRITERS); analyzeStoryNotes AI (professional dev-desk analysis, works pre-project via chatJsonCore refactor); New Project import panel + Apply-to-form; config.medium (ANIME/MANGA/LIGHT_NOVEL/NOVEL/WEBTOON/OTHER — taxonomy in entities/project.ts to keep the graph ACYCLIC); DossierService + PdfWriter (A4 Helvetica base-14, section page-breaks, footers): ficha técnica, bibles, page-per-character cast, per-episode beats+checklist, production status, commercial strategy, BR advocacy (CF/LDA/LGPD/8.685/14.216/SeAC + AI notes), risks/roadmap/improvements, originality declaration, glossary → .txt + 30-45+ page .pdf in exports/dossier/; job-based, aiEnriched best-effort; Overview card + dossier:last; i18n keys; 193 tests, 47/47 smoke (+2 real-fixture steps) |
| v0.14.0 | Total persistence + palette fix | Command palette painted BENEATH its overlay (cmdk 1.x siblings semantics — content now fixed+centered z-[71], overlay z-[70]); settings clobber ROOT-CAUSED and fixed with section-patch architecture (AppSettingsPatch omits content — the renderer cannot express license/mature writes; SettingsService.patch merges provided sections; 3 cards send only their sections; regression tests); session persistence: settings.session.lastViewByProject + lastProjectPath (auto-reopen last project on launch, restore last page per project, debounced 600ms writes); usePersistedState hook (Workflows episode/scene, Production tab); 183 tests (settings 10) |
| v0.13.1 | Quality pass | QC: task-overdue (CRITICAL=ERROR) + scene-subtitle-overlap checks; i18n now covers ALL visible surfaces (17 page h1s via new `<T>` component in system/T.tsx + SettingsPage General card wired — keys existed but were never called); overdue badge on board cards; fetch-ffmpeg platform-aware (win/mac config-ready, UNTESTED flag); 179 tests (core 131) |
| v0.13.0 | Backlog complete | ASS subtitles (V4+ codec, import/export, 5 tests), task due dates + Calendar view (migration 0011), BUNDLED GPL FFmpeg 7.0.2 (libx264, separate-process, license included) (fetch-ffmpeg.mjs at package time, ffmpegBin resolver: env → asar.unpacked → resources → dev → PATH; renders work with no system FFmpeg), Workflows Node Builder (drag-drop canvas, chain reorder, sequential run, localStorage positions) |
| v0.12.3 | Auto-fit + genres | appearance.autoFit (ON default): root font-size adapts to WINDOW HEIGHT on resize (12.5/13.5/14.5/16px breakpoints) — the UI shrinks itself on small screens; window double-clamped (useContentSize+center, post-ready-to-show hard clamp); visible scrollbars (#4a5478 thumbs); genres: 293 total (41 mature) |
| v0.12.2 | Mature Mode advanced | QC adults-only on 18+ productions (ambiguous/minor cast = QC ERROR before runtime block), 3 adult style presets in the Style Bible (Sensual Bishoujo/Seinen Erotic/Dark Fantasy Succubus, Pro-gated), provider compatibility notes in ContentCard; FOUNDER LICENSE minted for yuaberry (10-year, features [mature], receipt at ~/MIRAI-STUDIO-PRO-KEY.txt) |
| v0.12.1 | pt-BR + adaptive window | ROOT-CAUSE fix: window was FIXED 1440×900 (bigger than laptop screens!) — now clamped to workArea + auto-maximize on small screens; scrollable modals (sticky header/footer, overflow content); i18n foundation with pt-BR translation (nav, Hub, New Project, Settings; t(locale,key) with English-source keys in lib/i18n.ts) |
| v0.12.0 | POST-MVP | CINEMA archival render tier (CRF 14 + slower + aq3 params; MASTER upgraded to CRF16/slow), 7 new presets (Cinema 4K DCI 4096×2160, Cinemascope 2.39:1, Action 60fps, 8K, Vertical 4K, Square), IMAGE-TO-VIDEO (input_reference = storyboard keyframe), fps/quality options for AI video (HD default), batch keyframes, 170+ genres |
| v0.11.0 | Adaptability + Pro expansion | CRITICAL fix: native selects opened system-white (color-scheme:dark + option painting); RESPONSIVENESS: appearance.uiScale (85–140%) + density wired to root font-size (whole rem-based UI adapts); genres expanded to 140+ industry tags incl. 24-tag mature block; MATURE_PROMPT_PACK (8 Pro entries in Prompt Library, gated); New Project content-rating select + AUTO-18+ rating on mature genres; ContentCard unlock list |

---

## 12. CURRENT STATE (as of this file's creation)

- **Repo**: https://github.com/yuaberry/mirai-studio (public, main branch)
- **Website**: https://yuaberry.github.io/mirai-studio (v0.4.0)
- **Latest release**: v0.4.0 (GitHub Releases: .deb + AppImage)
- **All tests**: 166 passing (15 shared + 27 AI + 124 core — incl. 10 license/policy/blender tests)
- **Smoke**: 45/45 steps passing (incl. Producer Agent end-to-end)
- **Lint**: 0 errors, 0 warnings
- **Typecheck**: 0 errors (4 workspaces)
- **IPC channels**: 152 contracts, 153 handlers
- **Migrations**: Project 0001-0010 + App 0001-0002
- **Latest release**: v0.10.1 (.deb + AppImage, boot-tested)
- **Website**: https://yuaberry.github.io/mirai-studio (v0.10.1 — professional redesign: app mockup, producer terminal, full studio grid, pipeline, Pro section, changelog)
- **License private key**: `mirai-license-private.pem` (kept OUTSIDE the repo, on the dev machine) — mint keys with `scripts/licensegen.mjs`
- **Backup**: `/home/llinux/mirai-studio-backup-v0.10.0.tar.gz`

---

## 13. IS MIRAI STUDIO "FINISHED"? — STATUS ANSWER (v0.12.0)

**The original vision (Phases 0-9) is COMPLETE and the MVP box was left at v0.12.0**: the app is a full AI-native anime production studio — idea → episode → studio-grade MP4 — with production management, extensibility, licensing (Pro), adult-content discipline, adaptive UI and world-class render encoding. What remains are NEW FRONTIERS, not missing pieces:

1. **Showcase production**: the app needs a real anime produced END-TO-END with it (a full episode published as the flagship demo) — content work, not code.
2. **Distribution frontiers**: multi-user/cloud sync (real team permissions), remote marketplace (one-click plugin install), dubbing/translation pipeline, web-companion for approvals.
3. **Production-grade polish**: keyframe batch concurrency, Blender custom path/presets, mature QC extras (age disclaimer burn-in), onboarding tour.
4. **Maintenance**: OS updates (Electron/node), provider API drift, community plugins.

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

*Last updated: v0.17.0 — CI ABI bug fixed (proven ABI_OK), theme system (dark/black/light/sakura/custom), visual polish. 194 tests, 47/47 smoke, CI 5 jobs. Compact freely: this file carries the full state; after compaction ask 'read the Plan.md in the mirai-studio repo'.*
*Repository: https://github.com/yuaberry/mirai-studio*
*Website: https://yuaberry.github.io/mirai-studio*
