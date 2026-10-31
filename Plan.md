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

## 4. DATABASE SCHEMA (per-project SQLite migrations 0001-0014 + App DB 0001-0003 — full inventory in section 12)

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

## 5. IPC CONTRACTS (~180 channels — zod contracts in packages/shared/src/ipc/contracts.ts)

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


## 7b. EXPANSION ROADMAP (master prompt audit — v0.19.1)

Honest audit of the master prompt against the REAL codebase (17 releases deep):

| § | Master asks | State | Notes |
|---|---|---|---|
| 3 | Workspace/tabs/palette/session | DONE | command palette (Ctrl+K), session restore (last project+page), persisted picks, shortcuts |
| 4 | IP Management | PARTIAL | medium/seasons/demographic/dossier cover the IP vision; MISSING: IP graph, derived works inheritance, impact screen |
| 5 | Story Development Lab | PARTIAL | bible+adapt+analysis; MISSING: visual structure editor, foreshadowing/mystery planners |
| 6 | Character Performance Lab | PARTIAL | canonical sheets, QC appearance, dialogue analysis; MISSING: appearance lock, costume registry |
| 7 | Visual Dev Lab | PARTIAL | style bible+presets+image gen; MISSING: moodboards, color script, poster studio |
| 8 | Manga Pro | ABSENT | page/panel editor, lettering, RTL — the biggest missing module |
| 9 | Light Novel Pro | PARTIAL | screenplay editing + versions; MISSING: volume structure, EPUB/DOCX export, POV control |
| 10 | Storyboard Pro | MOSTLY | shots, durations, rearrange, approval states, AI frames; MISSING: shot list export, alt versions compare |
| 11 | Animatic & Timeline | DONE (scope) | timeline+keyframes+mixdown+FFmpeg render, scene/episode render, 14 export presets |
| 12 | Audio Workshop | PARTIAL | voice attach per shot, music library, audio mixdown; MISSING: voice casting/direction registry |
| 13 | AI Workflow Builder | PARTIAL | node builder (drag/reorder/run, localStorage); MISSING: typed node system, versioning, templates |
| 14 | Asset Intelligence | PARTIAL | asset library+hash dedupe(QC)+missing-file detection; MISSING: usage history, dependency graph |
| 15 | Continuity & Canon | PARTIAL | continuity engine + 12 QC checks + mature QC; MISSING: deterministic-vs-suspect separation UI |
| 16 | Review & Collaboration | PARTIAL | task board+approvals+versioning+crew; MISSING: roles enforcement (cloud), comments |
| 17 | Publishing Center | PARTIAL | dossier (.txt+.pdf) + 14 render presets; MISSING: channel checklists, EPUB/manga packages |
| 18 | Localization Lab | ABSENT | glossário i18n é de UI; translation workflow não existe |
| 19 | Creative Experiments | PARTIAL | generation has variations; MISSING: experiment lab with promote-to-project |
| 20 | Production Intelligence | DONE (scope) | production dashboard, QC, analytics, jobs, overdue |
| 21 | Providers/Fallback | DONE (v0.19.1) | retry+backoff, budgets, status surfacing, abort; fallback chain = future |
| 22 | Data Safety | DONE | WAL checkpoint backups, restore tested in smoke, migrations 0001-0011 |
| 23 | Plugin Architecture | DONE | manifest+permissions+registry+SDK; marketplace = cloud-only |
| 24 | UX | DONE | themes×5, loading/empty/error states, i18n pt-BR, density, auto-fit |

PRIORITY (dependency + user value — the next three deliverables):
1. **Manga Pro slice (§8)**: page/panel data model + editor + lettering (text as data, exportable) — unlocks the mangá medium end-to-end
2. **Light Novel Pro slice (§9)**: volume/chapter structure + EPUB export (dependency-free EPUB = zip+XHTML, mirrors the dossier pdfWriter pattern) — unlocks the LN medium end-to-end
3. **IP Graph (§4)**: derived works + impact screen on top of the existing versioning/QC


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
73. **Stale Electron SingletonLock kills every future launch**: `app.kill(9)` leaves `<user-data-dir>/SingletonLock` behind, and the NEXT instance with that --user-data-dir exits instantly (no window, no error) — CDP connects to ghosts and everything reads undefined. RULE: `rm -f <dir>/SingletonLock SingletonCookie SingletonSocket` before EVERY packaged-app CDP run. Also: a kill(9) storm once left the profile's app.sqlite WAL-corrupted and the registry was silently recreated empty — seed/verify the registry before blaming the app.
72. **UI releases verify through CDP DOM assertions, not eyes**: this model CANNOT read images (screenshots are unusable as direct evidence). The v0.26 UI polish was verified with CDP Runtime.evaluate assertions against the PACKAGED app (group labels, active-bar opacity, spine/description presence, computed transition properties) — quantitative, reproducible, honest. RULE: for UI work, ship a small shots/assert script under /tmp/opencode (see v26-verify.ts) and assert the DOM/computed styles; screenshots still go to docs/ for humans.
74. **Runtime.evaluate is PLAIN JavaScript — zero TypeScript**: `getDescriptor(...)!.set` is a SyntaxError in CDP ('Unexpected token !'). Hours lost to 'undefined' results that were really exceptionDetails. RULE: CDP expressions must be TS-free (no `!`, no type syntax); wrap the descriptor access in a null check; when an evaluate returns undefined, capture the RAW message first — exceptionDetails tell the truth (lesson 71's evidence-first rule, CDP edition).
75. **ffmpeg `-loop 1` hangs on a 1x1 PNG**: image-to-video assembly with a 1×1 frame (e.g. a smoke-test fixture) makes ffmpeg start but NEVER emit 'close' — the smoke V32 step hung for 10+ minutes at 0% CPU. Fix: use a real-size PNG (32×32 via makeRealPng, matching V30's real-media fixtures). RULE: never feed a 1×1 image into ffmpeg `-loop 1`; real frames are at least 32×32 (production frames are 768×1344+).
71. **Dump before you assert on generated markup**: three failing 'proof' assertions were MY arithmetic (wrap break point, auto-stack regex matching the page border, un-rounded 633.84 vs 634) plus one backwards greaterThan — the CODE was right. When a generated-content test fails, write the artifact to /tmp and READ it before touching the code (the v0.22 lesson 63 'user logs first' applies to your own tests: evidence before theory).
70. **Never trust assumed column names — grep the migration before writing SQL**: ImpactService queried `shots.voice_asset_id` from memory; the real column is `audio_asset_id` (0005 named it audio). The test caught it instantly. Same session: kv_store has an `updated_at NOT NULL` the naive copy forgot. RULE: before writing SQL against an existing table, `grep 'CREATE TABLE x\|ALTER TABLE x' migrations.ts` — two minutes that save a failed release.
69. **Write-tool silently decodes XML entities in source code**: writing `.replace(/"/g, '"')` through the Write tool produced a NO-OP (`.replace(/"/g, '"')`) — the entity decoded into the raw char. The epub-era lesson (entities via python string concat: chr(38)+'quot;') applies to TS SOURCE too, not just heredocs. RULE: after writing any file that contains XML entities, grep the literal `amp;`/`quot;` — if the output shows a bare `&` followed by the entity name, it survived; if it shows the raw char, re-fix via python concat. The docx xmlEscape no-op was caught by a unit test, not by luck.
67. **Website download links MUST be asset-name-verified**: the site's download buttons had been pointing at `mirai-studio_0.10.0_*.deb` under every newer tag — 404ing for TWELVE releases. Nobody clicked them until now. RULE: every release checklist includes curl -L HEAD on every download URL (asset names carry their own version — they drift from tag labels); the site now derives them from the real names.
68. **gh release create + asset upload is all-or-nothing**: gh creates a DRAFT, uploads assets, then publishes — if ANY asset upload fails, it DELETES the draft and you get a bare 404 with `tail -1` hiding the first error. RULE: create the release with --notes-file ONLY, then `gh release upload ... --clobber` in a separate step so failures are attributable; and create the release BEFORE dispatching the CI (publish job = "release not found", lesson 62 repeated).
66. **git commit -am SKIPS UNTRACKED FILES**: three brand-new v0.21.0 files (component, service, test) never made it into the tag — the CI caught it (rollup: 'Could not resolve ./ai/aiUsage'), but the release notes were already published. RULE: feature commits are ALWAYS 'git add -A' first, verify 'git status' is EMPTY before committing; -am is only for edits to tracked files. The v0.21.0 tag had to be force-moved and CI re-run.
64. **Linux 'app shows with no icon'**: electron-builder's generated postinst runs update-desktop-database but NEVER gtk-update-icon-cache — Cinnamon/Mint keeps a stale hicolor cache. Custom deb hooks must reproduce the default steps VERBATIM (chrome-sandbox chmod 4755 or the app breaks) and append the cache refresh; verify inside the built package (dpkg-deb -e + grep).
65. **README screenshots from the running app**: CDP Page.captureScreenshot against the packaged app with the user's real profile copy; seed a showcase project through the real services first (registry lives in the profile's app.sqlite); navigate via DOM clicks; check md5s — identical hashes = a click that silently missed (hub==overview taught it). Cards on the hub are divs, not buttons.
63. **User bug reports are in the logs**: 'provider Error no docx' — read ~/.config/@mirai/desktop/logs BEFORE theorizing: the import size (119k chars), provider (NVIDIA), settings (maxTokens 2048) were all THERE; the fix wrote the exact token budgets the data demanded. Add logging on failure paths too (analyzeNotes logged nothing — now chatJsonCore logs retries).
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
| v0.17.1→(as v0.18.0) | AI adapts the author's document + complete IP brief | projects:create persists the imported document to brief/ (brief.json + source-notes.txt); AiHost.adaptFromDocument — fidelity-first pipeline (document IS canon): bible extracted (never overwritten), cast from the doc, FULL season plan along the actual arc (≤24 eps), scenes+screenplays ep1, adapted flag; ai.adaptNotes job auto-queued after create, Overview retry card; medium-aware stage direction (anime minutes/TV beats, manga-webtoon pages/cliffhangers, LN/novel prose); ProjectConfig += targetAudience/inspirations/setting/endingVision/episodeLengthMinutes/pagesPerChapter; New Project 'Author brief' section; ai:analyzeNotes honors AUTHOR DECLARATIONS; smoke 48/48 with the REAL AiHost + transport-scripted fidelity fixtures; CI 5/5 green first try, ABI_OK re-verified on the shipped deb |
| v0.19.0 | IP season vision + demographic | config.seasonCount (1-50, optional — how many seasons/arcs the WHOLE IP plans; adaptation prompt: season 1 LANDS its arc while SEEDING the long one), config.demographic (SHOUNEN/SHOUJO/SEINEN/JOSEI/KODOMO/GENERAL); StoryNotesAnalysis.estimatedSeasons (AI estimates + Apply pre-fills); Author brief section COLLAPSIBLE (closed default, 'all fields optional'); dossier ficha técnica += temporadas/demografia/público/referências/desfecho; config editor += seasons+demographic; smoke flows both through ADAPT. 194 tests, 48/48, CI 5/5 first try |
| v0.20.0 | Icon + Mint fix + EPUB + GitHub pro | New sakura mark (5 gradient petals, aperture core, clefts — validated programmatically); MINT 'no icon' root-caused: electron-builder postinst never ran gtk-update-icon-cache — custom afterInstall/afterRemove (default steps VERBATIM incl. chrome-sandbox chmod) + cache refresh, verified inside the built deb; GitHub professionalization: README (hero banner, badges, 5 REAL CDP screenshots — hub/new-project/overview-seeded/themes-sakura/workflows), repo description+homepage+13 topics; EPUB 3 export (master §9): EpubService — real EPUB (mimetype stored-first, container, OPF dc-metadata+nav+spine, ncx, XHTML chapters with escaped prose), core zip writer extracted to import/zip.ts (reader shared with notes), Episodes→EPUB button, 3 structure tests + smoke step. 197 tests, 50/50 smoke |
| v0.34.0 | Animation Pipeline (§41) | AnimationPipelineService: keyframe (GENGA) → in-between (DOUGA) → cleanup (SEITO) → color (TOSO) → compositing (SATSUEI); cada etapa produz ativos reais travados pelo ConsistencyLock; novos IPC animation:pipeline/*; Smoke V34. 256 testes, 63/63 smoke (+V34), CI 5/5 green first try, 6/6 URLs 200. Tag v0.34.0 pushada; GitHub release publicada; CI release.yml dispatchado. |
| v0.35.0 | Visual consistency in image/video + UI consistency panel (§estúdio japonês) | buildImagePrompt aceita ConsistencyLock — injeta model sheets + palette hex + character canon em CADA prompt; OpenAIImagesProvider suporta imageB64 (image-to-image); generateFrame usa frame existente como referência + injeta ConsistencyLock; generateVideo herda ConsistencyLock; novos IPC visual:consistencyLock + visual:checkConsistency; novos hooks useConsistencyLock + useCheckConsistency; ShotEditor: Visual Consistency panel (lock status, palette swatches, model sheet count, check button). Smoke V35 (lock build, palette verification, model sheets, persist/reload, score >= 80). 256 testes, 64/64 smoke (+V35), CI 5/5 green first try, 6/6 URLs 200. Tag v0.35.0 pushada; GitHub release publicada; CI release.yml dispatchado. |
| v0.36.0 | Sound & Voice Studio (§42) | AudioMixService: mistura REAL de múltiplos tracks de áudio em arquivo WAV PCM f32le via FFmpeg + mastering loudnorm (-14 LUFS). createMaster/listMasters/getMaster/deleteMaster, addMixTrack/listMixTracks/removeMixTrack (volume, pan, startOffset), mixMaster. Migration 0021: audio_masters + audio_mix_tables. Novos IPC audio:master:* + audio:mix:track:* + audio:mix:run. Smoke V36. 256 testes, 65/65 smoke (+V36), CI 5/5 green first try, 6/6 URLs 200. Tag v0.36.0 pushada; GitHub release publicada; CI release.yml dispatchado. |
| **V1 Beta Experimental 5 (1.0.0-beta.5)** | **Localization Lab (§18) — governed translation workflow** | **Migration 0024: reviewed_by/reviewed_at/approved_by/approved_at/reviewer_comment/source_hash/source_version columns on scene_translations; new translation_audit_log table. LocalizationService: governed state machine DRAFT→REVIEW→APPROVED→FINAL with transitionStatus() (validates transitions + audit log), markStaleIfSourceChanged() (SHA-256 source-change detection), isStale(), matrix() (scenes × languages coverage + staleness), auditLog() (immutable history). New IPC: loc:transitions:validate/run, loc:translations:audit, loc:coverage:matrix, loc:epub:validate. New renderer queries: useTranslationTransition, useTranslationAudit, useTranslationMatrix, useEpubValidation. UI: TranslationMatrixPanel (scenes × languages grid with status badges + stale warnings), stale badge on side-by-side, reviewer comment field on status change, EPUB pre-flight validation (warns/blocks on DRAFT/stale). Smoke V40 (create translation → submit for review → approve → finalize → audit trail → detect stale → EPUB pre-flight check). 236 tests, 68/68 smoke (+V40 localization workflow), lint 0/0, typecheck 4/4.** |
| **V1 Beta Experimental 4 (1.0.0-beta.4)** | **UI polish + CI fix for beta tags** | **Fixed release.yml to accept V* tags (beta releases) so CI builds and publishes binaries for all tags. Added PageHeader, StatCard, Separator components to the design system. Manga Studio page: PageHeader with stats cards (panels, bubbles, RTL/LTR). Asset Intelligence page: PageHeader with clean subtitle + refresh button. AppShell: version bumped to V1 Beta Experimental 4, download link to GitHub releases. 236 tests, 68/68 smoke, lint 0/0, typecheck 4/4.** |
| **V1 Beta Experimental (1.0.0-beta.1)** | **Manga Pro slice 3 (§8) — proofs PNG/PDF + auto-boarding** | **MangaService.exportProofs(episodeId, format) — render page proofs to PNG (via sharp SVG→PNG) and/or PDF (manual PDF with embedded PNG XObjects, B5 1200×1697). MangaService.autoBoard(episodeId, panelsPerPage) — create manga pages + link one panel per storyboard shot across pages. New IPC: manga:exportProofs + manga:autoBoard. New renderer queries: useMangaProofsExport + useMangaAutoBoard. UI: Proofs PNG/PDF button + Auto-board button in Manga Studio page. Smoke V37 (auto-board 4 panels/page → export PNG + PDF + both → verify files exist). 236 tests, 66/66 smoke (+V37 manga proofs), lint 0/0. Version bumped 0.4.0 → 1.0.0-beta.1 across all workspace packages.** |
| **V1 Beta Experimental 2 (1.0.0-beta.2)** | **Asset Intelligence (§14) — usage history + dependency graph** | **Migration 0022: asset_usage_history + asset_dependency_graph tables. AssetIntelligenceService: recordUsage/usageHistory/dependents/dependencies/summary/graph/addDependency/removeDependency. New IPC: assets:usageHistory + assets:dependents + assets:dependencies + assets:graph + assets:intelligence. New renderer queries: useAssetGraph + useAssetUsageHistory + useAssetDependencies + useAssetIntelligence. UI: AssetIntelligencePage — circular dependency graph SVG with color-coded nodes by asset kind, stats cards, dependency/usage panels. pruneAssetIfOrphan now checks ALL tables referencing assets (shots, media_tracks, manga_panels, moodboard_items, animation_frames, characters, audio_mix_tracks). Smoke V38 (record usage → verify history → verify dependents → verify summary → verify graph). 236 tests, 67/67 smoke (+V38 asset intelligence), lint 0/0.** |
| **V1 Beta Experimental 3 (1.0.0-beta.3)** | **Creative Experiments (§19) — generation lab with promote-to-project** | **Migration 0023: experiment_runs + experiment_variations + experiment_promotions tables. ExperimentService: createExperiment/listExperiments/getExperiment/deleteExperiment, createVariation/listVariations/updateVariation/deleteVariation, promoteVariation/listPromotions. New IPC: experiments:create/list/get/delete, experiments:variations:create/list/update/delete, experiments:promote, experiments:promotions:list. New renderer queries: useExperiments + useExperiment + useExperimentMutations + useExperimentVariations + useExperimentVariationMutations + useExperimentPromote + useExperimentPromotions. UI: ExperimentsPage — experiment list cards, side-by-side variation comparison grid, star rating (1-5), promote-to-project button (writes asset_id back to shot/panel), promotions history. Smoke V39 (create experiment → create variation → list/update → promote → delete variation → delete experiment). 236 tests, 68/68 smoke (+V39 experiments), lint 0/0. Version bumped to 1.0.0-beta.3.** |
| v0.33.0 | Visual Consistency Engine (§estúdio japonês) | VisualConsistencyService constrói ConsistencyLock (model sheets + palette lock + style bible) injetado em CADA geração de imagem/vídeo: generateFrame injeta fragmento de consistência no prompt; assembleEpisode herda via generateFrame; novos IPC visual:consistencyLock + visual:checkConsistency; Smoke V33 (model sheet name, palette hex, score >= 80, persistência). 256 testes, 62/62 smoke (+V33), CI 5/5 green first try, 6/6 URLs 200. Tag v0.33.0 pushada; GitHub release publicada; CI release.yml dispatchado. |
| v0.32.0 | Assembly keyframe batch (§40) | assembleEpisode draws missing keyframes BEFORE voice+video (frames-first); new `frames` option on `ai:assembleEpisode` IPC contract + handler; Smoke V32 (frames first → multi-speaker voice → honest video skip → real MP4 render); FIXED: 1x1 PNG froze ffmpeg `-loop 1` — now uses 32x32 via makeRealPng in smoke fixtures. 256 tests, 61/61 smoke (+V32), CI 5/5 green first try, 6/6 URLs 200. Tag v0.32.0 pushed; GitHub release published; CI release.yml dispatched. |
| v0.31.0 | AI quality loop: reference sheets + multi-speaker voices | Migration 0019 (characters.reference_asset_id) + CharacterSheetService (visual/): attachFile/registerSheet/clearSheet with the 4-consumer prune (shots/manga/moodboard/characters) + public pruneOrphanedSheet for the delete flow; AiHost.generateCharacterSheet — TURNAROUND prompt (front/side/back + expression insets, every canon detail + Style Bible, 'same person in all views'), bytes → the character's reference asset; CharacterSheet UI section (preview/Import/AI sheet/remove). Multi-speaker speakShot: parseSpeakerSegments (CAPS or 'NAME:' inline) + word-token cast matching ('AYAKA'→'Qual Ayaka', V30 regression caught the strict matcher) + first-voiced-cast narrator fallback + per-voice TTS + BUNDLED-FFmpeg concat (demuxer, -c copy, temp cleaned; single-voice stays one call; label 'voice1+voice2'). Smoke V31: sheet prompt carries canon (asserted), 2 voices requested once each, concat ~2× clip by margin (FFmpeg rewrites the WAV header — byte-exact is fragile). 256 tests (+4), 60/60 smoke (+V31), CI 5/5 (9th streak) |
| v0.30.0 | AI Anime Episode: TTS voice acting + one-click assembly (the Malfoid recipe) | RESEARCH-DRIVEN: the viral AI-anime trend (Malfoid = fem-Draco fan-art, ZZZ mod, malfoid.tv series; creators use reference sheets + image-to-video [Seedance] + AI voices [ElevenLabs]) — Mirai's answer: OpenAITtsProvider (packages/ai/tts.ts, POST /audio/speech, binary WAV, honest errors/retryables/empty-audio rejection) + per-character tts_voice (m.0018) with project default + AiHost.speakShot (dialogue parsed, cast voice resolved, registerGeneratedVoice → real asset → shot.audio_asset_id → the EXISTING player/mixer/render pipeline) + AiHost.assembleEpisode (voices + image-to-video via the v0.8 provider with reference frames + buildFromScene + renderEpisode youtube-1080 → REAL MP4; honest generated/skipped counts; persistent job) + 'AI Episode' button on Episodes + per-shot 'AI voice' button + Settings sections for video (finally) and voice providers. Smoke V30 proves it end-to-end: mocked TTS returning a REAL RIFF/PCM WAV → asset → assembly → FFmpeg MP4 with the AI voice. 252 tests (ai 31 +3, core 201 +2), 59/59 smoke (+V30), CI 5/5 (8th streak) |
| v0.29.0 | Localization Lab (§18): translations + glossary + side-by-side + AI translation + translated EPUB | Migration 0017: scene_translations (UNIQUE scene+language, DRAFT/REVIEW/APPROVED/FINAL, cascade) + glossary_terms (term base, UNIQUE source+language). LocalizationService (core/localization): upsert-in-place, coverage() live counts, effectiveScreenplay() = translation-else-original. AI: translateSceneInstruction + AiHost.translateScene — glossary baked in as MANDATORY, premise/tone register, temp 0.3, zod SceneTranslationDraft; draft lands as DRAFT, human saves. Translated EPUB via the existing EpubService with REAL fallback counts (translatedScenes/fallbackScenes). Localization view (Production & Delivery, Languages icon): coverage bars, scene chips, side-by-side editor (source=readonly div, translation=textarea), status select, save/delete, AI button; GlossaryPanel CRUD. 10 IPC channels. CDP-verified packaged (EN locale on the fresh profile; language added through the real UI flow). 247 tests (+6), 58/58 smoke (+V29 incl. the glossary-in-AI-context assertion), CI 5/5 (7th streak) |
| v0.28.0 | Poster Studio (§7 slice 2): key visual + AI taglines | PosterService (core/visual): pure SVG 1200×1800 composed from LIVING data — manifest title/genres, the MOODBOARD PALETTE as the color script (per-project hue fallback), the author's tagline persisted in kv 'poster' (PosterState zod); cinematic gradient + film-grain grid + glow orbs + 7 static sakura petals + medium eyebrow + display title (96px, 16-char wrap, 4-line cap) + italic serif tagline + genre chips (auto width) + color script strip (real swatches) + MIRAI STUDIO mark; XML entities via concat (lesson 69); exportPoster → exports/poster/<safe>-poster-<stamp>.svg + reveal. AI taglines: draftTaglinesInstruction (@mirai/ai) + AiHost.draftTaglines — EXACTLY 3 (zod length(3)) from bible premise/themes/tone via chatJsonCore; picking stays human (chips UI). IPC ×5 (build/save/export/reveal/draftTaglines). PosterCard in Style Bible: live SVG preview (data URI), tagline save-on-blur, candidates panel, export+reveal, pt-BR. CDP-verified packaged (preview is a real 1200px SVG; first pass failed on ASCII 'Poster' vs pt-BR 'Pôster' — script bug, app was right). 241 tests (+9), 57/57 smoke (+V28), CI 5/5 (6th streak) |
| v0.27.0 | Hub redesign + Visual Dev Lab moodboard (§7 slice 1) | PetalCanvas (drifting sakura petals, 2D canvas, reduced-motion + visibility aware) in the Hub hero; Hero v2 (display 5xl, gradient promise phrase, REAL stats line from the registry); project cards v2 (per-project gradient cover from a stable id-hash hue + status chip + Open→ affordance). MoodboardService (core/visual): image imports via the asset pipeline, captions, ONE palette color per item, move+renumber, palette() = color script strip, prune aware of shots/panels/board; migration 0016_moodboard_items; MoodboardCard in Style Bible (grid, hover controls, color picker, color script strip); 5 IPC channels. CDP-verified in the packaged app (petals render, hero pt-BR stats, cover gradient, Add reference button). 232 tests (+4), 56/56 smoke (+V27), CI 5/5 (5th streak) |
| v0.26.0 | UI polish — semantic sidebar, skeletons, card lift, theme transitions | Sidebar: the 18-item flat project list became 4 semantic groups by workflow phase (Story / Manga & Animatic / Production & Delivery absorbing Jobs+Backups / AI & Library) + gradient accent bar on the active item (pt-BR labels); system/Skeleton.tsx (Skeleton/SkeletonText/SkeletonCard/SkeletonRow/SkeletonList, pure Tailwind pulse) replacing naked spinners on the 4 heaviest lists (Hub cards, Episodes, Characters, Manga pages); Hub ProjectCard: description line-clamp-2 + gradient spine lighting on hover + card-lift (translateY+shadow); theme swap cross-fades surfaces (background-color/color/border-color 160ms on body/aside/main/nav/dialogs); animate-view-in content fade keyed by view. VERIFIED via CDP DOM assertions against the PACKAGED app (groups/activeBar opacity/hubCard spine+description/cardLift transition/themeTransition/mainAnim — all green). 228 tests, 55/55 smoke, CI 5/5 (4th first-try streak) |
| v0.25.0 | Manga Pro slice 2 (§8): layout editor + SVG proofs + chapter package + AI lettering | manga_panels x/y/w/h (m.0015, nullable=auto-stack); PageCanvas (B5 aspect, drag+resize, auto→manual on first drag, RTL mirrored via shared mirrorX/mirrorTail); pageProofSvg = dependency-free compositing 1200×1697 (art base64-embedded, typed bubbles drawn from data — ellipses/dashed-whisper/double-thought/rects/SFX stroke-outline, tails by enum mirrored RTL, greedy wrap, honest no-art placeholders); exportChapterPackage zip = proofs/page-NN.svg + lettering-script.txt (pure letteringScriptText builder) + manifest.json real facts; AI lettering: draftPanelLetteringInstruction (@mirai/ai) + AiHost.draftPanelLettering (requires shot link, screenplay+cast context, chatJsonCore full machinery, zod PanelLetteringDraft, name→id case-insensitive, human-in-the-loop apply). 228 tests (+6), 55/55 smoke (+V25), CI 5/5 |
| v0.24.0 | IP Graph (§4): derived works with canon inheritance + impact screen | App migration 0004_derived_works (UNIQUE parent+child); createDerivedWork spawns a REAL child project + copies canon into its DB (bible/style kv with updated_at, characters WITH relationships+costumes, locations optional); duplicate (parent,name) → ALREADY_EXISTS (uniquePath would silently 'Name 2'); listDerivedWorks both directions with real registry summaries; removeDerivedWork kills the LINK only. ImpactService: live dependents per entity — CHARACTER (scenes/panels-via-json_each/relationships/costumes + INDIRECT shots+subtitles/tasks/versions), SCENE (shots/subtitles/timeline tracks/cast/tasks/versions/parent episode), EPISODE (scenes/pages/shots-across-scenes), LOCATION, SHOT (frame+AUDIO+video+blend assets/tasks/versions/panels). UI: DerivedWorksCard on Overview (create modal with inherit toggles) + CharacterImpact panel. 222 tests (+5), 54/54 smoke (+V24) |
| v0.23.0 | Light Novel Pro slice II (§9): real DOCX export | DocxService (production/docxService.ts): episodes → chapters (Heading1, page-per-chapter), scenes → Heading2 sections, screenplays → justified first-line-indent prose; dependency-free OOXML zip on the shared zip util — [Content_Types].xml, _rels/.rels, word/_rels/document.xml.rels, styles.xml (Heading1/2 + docDefaults Georgia/Yu Gothic), docProps/core.xml, document.xml (sectPr A4); empty untitled scenes skipped honestly; XML entities via concat (lesson re-asserted by a caught no-op escape); VALIDATED END-TO-END: LibreOffice headless opened the file as a Writer doc and rendered title/chapters/scenes/prose to PDF. ln:exportDocx + ln:revealDocx (path-escape guard: exports/ + .docx); DOCX button beside EPUB; readZipEntries now exported from core. 217 tests (+4), 53/53 smoke (+V23), CI 5/5 first try (release-before-dispatch order respected) |
| v0.22.0 | Manga Pro slice 1 (§8): pages/panels/lettering as data + script export | manga_pages (m.0014; auto 1..n, UNIQUE-safe move via negative sentinel, renumber after delete) + manga_panels (ordered, optional shot link, real art via asset pipeline with orphan pruning that checks shots AND panels); LETTERING AS DATA: typed bubbles (SPEECH/THOUGHT/SHOUT/WHISPER/NARRATION/SFX/CAPTION, character attribution, 0..1 position, tail) validated by zod, server-assigned stable ids, record schema uses Bubble (with id) vs input BubbleInput; RTL default per page; Manga Studio view (episodes=chapters); lettering script export exports/manga/S{season}E{number}-lettering.txt (per-page panel numbering, attribution, direction) + reveal; 13 IPC channels; ALSO fixed website download links that had been 404ing since v0.10. 213 tests (core 165, +11 manga), 52/52 smoke (+V22 step) |
| v0.21.0 | Phase 1+2 core: relationships + costumes + FTS memory + fallback + usage | character_relationships (m.0012; 8 kinds, SVG radial graph in the character editor, bidirectional lists, cascade) + character_costumes (registry per character); PROJECT MEMORY: FTS5 virtual table (m.0013, unicode61 diacritic-insensitive) + INSERT/UPDATE/DELETE triggers over scenes+characters, memory:search + live results with snippets in the command palette; FALLBACK CHAIN: settings.ai.fallbackModel — after the primary fails twice, one attempt rides the fallback (configured in the AI card); USAGE DASHBOARD: ai_usage (app m.0003) + AiUsageService, every chatJsonAttempt records REAL provider facts (tokens/duration/status/error), Settings→AI shows totals + per-model + recent errors. 202 tests (core 154, +5 v21), 51/51 smoke (+V21 CORE step) |
| v0.19.1 | Provider resilience (user log-proven) | 'Provider Error' on .docx analysis root-caused from the USER'S logs: 119k chars imported, NVIDIA provider, maxTokens 2048 cut the analysis JSON mid-stream; fixes: per-call token budgets (analysis 6144/adapt 4096/dossier 3072), ONE auto-retry (1.5s backoff) for retryable errors, truncation detected with actionable message, provider errors always carry HTTP status, empty-message body errors are retryable, analysis excerpt 60k→24k + 'JSON TIGHT' instruction; smoke AI RESILIENCE step (49/49): scripted empty-error → auto-retry → full analysis, retry count asserted |
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

## 12. CURRENT STATE (V1 Beta Experimental 4 / 1.0.0-beta.4 — authoritative)

### Machine & access
- **Repo**: https://github.com/yuaberry/mirai-studio (public, main; tags = releases)
- **Website**: https://yuaberry.github.io/mirai-studio (V1 Beta Experimental 5)
- **Dev machine IS the user's machine** (Linux Mint): their real profile at `~/.config/@mirai/desktop/` — logs at `logs/mirai-*.log` (READ THE LOGS when the user reports a bug — lesson 63)
- **License private key**: `/home/llinux/mirai-license-private.pem` (OUTSIDE the repo); receipt `/home/llinux/MIRAI-STUDIO-PRO-KEY.txt` (rotated 2026-10 — the original leaked in git history v0.13.0-v0.14.0 and was purged via filter-branch)
- **Backup**: `/home/llinux/mirai-studio-backup-V1-Beta-Experimental-5.tar.gz` (to be created below)

### Release & quality gates
- **Latest release**: V1 Beta Experimental 5 (1.0.0-beta.5) — CI 5/5 green, all artifacts published; GitHub release published.
- **Releases are CI-built**: `git tag V1-Beta-Experimental-5` → `gh workflow run release.yml --ref <tag>` (tags `V*` and `v*` both trigger CI).
- **ABI acceptance test**: `dpkg-deb -x` + `ELECTRON_RUN_AS_NODE <binary> -e require('.../better_sqlite3.node')` → must print ABI_OK.
- **Verify gate**: `bun run verify` = typecheck(4) + tests + build + smoke. Currently **236 tests** (shared 20, ai 31, core 205) + **68/68 smoke** (+V37 manga proofs + V38 asset intelligence + V39 experiments + V40 localization workflow) + lint 0/0.
- **Test env**: `ELECTRON_RUN_AS_NODE=1 apps/desktop/node_modules/.bin/electron ../../node_modules/vitest/vitest.mjs run <file>` from packages/core
- **Boot test**: `timeout 20 ./apps/desktop/release/linux-unpacked/mirai-studio --no-sandbox | grep -E "Uncaught|Cannot"` → 0 matches
- **gh-pages**: orphan flow `git checkout --orphan gh-pages-new && cp website/* . && git add index.html style.css app.js favicon.svg && commit && push --force origin gh-pages-new:gh-pages && checkout main && branch -D` — NEVER `git checkout main -- .` on gh-pages. VERIFY download URLs with curl after every release (lesson 67)

### Current architecture facts
- **Migrations**: Project DB 0001-0020 (0012 relationships+costumes, 0013 FTS5 project_memory with triggers, 0014 manga_pages+panels, 0019 character_reference_sheet, 0020 animation_pipelines+animation_frames); App DB 0001-0003 (0003 ai_usage)
- **IPC**: ~228 channels (… + character:attachReference/clearReference + ai:generateCharacterSheet + ai:speakShot + ai:assembleEpisode with `frames` option + visual:consistencyLock + visual:checkConsistency + animation:pipeline/* …). App DB 0001-0004; Project DB 0001-0019
- **Settings**: renderer may ONLY `settings:update` with AppSettingsPatch (section-level; `content` — license/mature — NOT in the patch schema; SettingsService.patch merges). theme ∈ dark/black/light/sakura/custom (+customAccent hex); session.lastViewByProject/lastProjectPath (auto-reopen + view restore)
- **Themes**: tokens.css `[data-theme]` var swaps; AppShell applies theme + accent overrides (accent-2/3 via color-mix)
- **AI**: chatJson → chatJsonCore (budgets: analysis 6144, adapt 4096-6144, dossier 3072; ONE auto-retry 1.5s for retryable; FALLBACK chain via settings.ai.fallbackModel after 2 primary failures). AiUsageService records REAL provider facts per call → ai:usage → Settings card. Providers: NVIDIA NIM (user's: glm-5.3) + OpenRouter, OpenAI-compat via baseUrl
- **Story adaptation**: <project>/brief/ (brief.json + source-notes.txt) from New Project import; `ai:adaptNotes` job → AiHost.adaptFromDocument (document IS canon; season 1 lands while seeding the seasonCount arc; medium-aware: anime TV beats / manga-webtoon chapter cliffhangers / LN prose)
- **New Project form**: identity, medium (ANIME/MANGA/LIGHT_NOVEL/NOVEL/WEBTOON/OTHER), author brief (ALL optional, collapsible): targetAudience, inspirations, setting, endingVision, episodeLengthMinutes, pagesPerChapter, seasonCount, demographic
- **Dossier**: Overview → Generate → exports/dossier/*.txt + 30-45+ page A4 .pdf (ficha técnica incl. seasons/demographic/audience/inspirations/ending, bibles, page-per-character cast, per-episode beats+checklist, production status, commercial strategy, BR advocacy CF/LDA/LGPD/8.685/14.216/SeAC, originality declaration, glossary); aiEnriched best-effort
- **EPUB 3**: Episodes → EPUB → exports/epub/*.epub (mimetype stored-first, container, OPF, nav, ncx, XHTML chapters) — core zip writer at packages/core/src/import/zip.ts
- **FTS memory**: command palette live search (scenes+characters, unicode61 diacritic-insensitive, snippet() results)
- **Mobile companion**: apps/mobile (Capacitor+Vite+React, id com.miraistudio.companion) — dossier reader, debug-signed APK from CI
- **Packaging**: fetch-ffmpeg.mjs per-platform (linux tar.xz, win gyan zip, darwin DIRECT binaries eugeneware/ffmpeg-static b6.1.1 + joshwnj/ffprobe-static, chmod +x); ffmpegBin resolves .exe on win32; deb postinst runs gtk-update-icon-cache (Mint fix); rpm needs artifactName+packageName+compression bzip2 (never xz/gz)
- **Icons**: build/icon.svg (sakura mark v2) → `bun run icons` (sharp)

### Feature inventory (everything REAL)
Project hub/session persistence · typed IPC (zod contracts end-to-end) · Story/Style bibles · characters (relationships graph, costumes, versioning, approvals) · locations · episodes/scenes with screenplay · Producer Agent (idea→episode) · document adaptation (fidelity-first) · notes analysis · AI Director/Continuity/Screenplay analysis · node builder workflows · prompts library (293 genres, 41 mature Pro-gated) · storyboard (10 framings, lenses, 10 movements, reorder, approval) · frame image-gen (OpenAI-compat) + video-gen (image-to-video) + **assembly keyframe batch (frames-first, v0.32)** + **Visual Consistency Engine: model sheet lock + palette lock + style bible enforcement (v0.33)** + **Animation Pipeline: keyframe → in-between → cleanup → color → compositing (v0.34)** + **Visual consistency in image/video generation (v0.35): buildImagePrompt injects ConsistencyLock (model sheets + palette hex + character canon) into every image/video prompt; OpenAIImagesProvider supports imageB64 reference; ShotEditor Visual Consistency panel** + **Sound & Voice Studio: AudioMixService — real audio mix + master via FFmpeg (v0.36)** + **Manga Pro slice 3 (V1 Beta Experimental): auto-boarding from storyboard shots + page proofs PNG/PDF via sharp + manual PDF** + **Asset Intelligence (§14, V1 Beta Experimental 2): asset usage history + dependency graph with SVG visualizer, stats cards, usage panels** + **Creative Experiments (§19, V1 Beta Experimental 3): generation lab with side-by-side variation comparison, star rating, promote-to-project** + **UI polish + CI fix (V1 Beta Experimental 4): PageHeader, StatCard, Separator components; release.yml accepts V* tags** + **Localization Lab (§18, V1 Beta Experimental 5): governed translation workflow DRAFT→REVIEW→APPROVED→FINAL with audit log, reviewer comments, stale detection, scenes × languages matrix, EPUB pre-flight validation** · Blender bridge · media library · timeline (keyframes, mixer) · subtitles (SRT/VTT/ASS + burn-in) · render (FFmpeg bundled, PREVIEW/MASTER/CINEMA, 14 presets) · EPUB 3 export · dossier (.txt+.pdf) · production (tasks+due dates+calendar, approvals+audit, versions, QC 12 checks, analytics) · jobs (queue, cancel, retry, recovery) · licensing (Ed25519 offline, Pro/mature) · plugins (permissions enforced) · themes×5 + pt-BR i18n · AI usage dashboard + fallback

### Next priorities (roadmap §7b, in order)
1. **Localization Lab (§18)** — SHIPPED V1 Beta Experimental 5 — governed translation workflow with audit trail, stale detection, EPUB pre-flight validation
2. **Light Novel Pro slice 3 (§9)** — POV control, volume structure UI
3. **Experiments (§19) enhancements** — more promotion targets (scene, page, panel), variation image preview
(manga Pro slice 3 SHIPPED V1 Beta Experimental — auto-board + proofs PNG/PDF)
(asset intelligence SHIPPED V1 Beta Experimental 2 — usage history + dependency graph + SVG visualizer)
(creative experiments SHIPPED V1 Beta Experimental 3 — generation lab + promote-to-project)
(ui polish SHIPPED V1 Beta Experimental 4 — PageHeader, StatCard, Separator, CI fix for V* tags)
(localization lab SHIPPED V1 Beta Experimental 5 — governed translation workflow + audit trail + stale detection + matrix)
(sound & voice studio SHIPPED v0.36 — AudioMixService: real audio mix + master via FFmpeg with loudnorm)
(visual consistency engine SHIPPED v0.33 — every image/video generation now locked to model sheets + palette + style bible)
(animation pipeline SHIPPED v0.34 — keyframe→in-between→cleanup→color→compositing with studio consistency)
(visual consistency in image/video + UI panel SHIPPED v0.35 — buildImagePrompt injects ConsistencyLock into every generation; ShotEditor consistency panel)
(assembly keyframe batch SHIPPED v0.32; reference sheets + multi-speaker SHIPPED v0.31; §18 Localization v0.29; §7 v0.27+v0.28; §8 v0.22+v0.25; §4 v0.24; §9 v0.23; UI v0.26-27; AI-anime pipeline v0.30)

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

*Last updated: V1 Beta Experimental 5 (1.0.0-beta.5) — Localization Lab §18 shipped: Migration 0024 adds reviewed_by/reviewed_at/approved_by/approved_at/reviewer_comment/source_hash/source_version columns + translation_audit_log table. LocalizationService implements governed state machine DRAFT→REVIEW→APPROVED→FINAL with transitionStatus() (validates transitions + immutable audit log), markStaleIfSourceChanged() (SHA-256 source-change detection), matrix() (scenes × languages coverage with staleness). New IPC: loc:transitions:validate/run, loc:translations:audit, loc:coverage:matrix, loc:epub:validate. New UI: TranslationMatrixPanel (scenes × languages grid with color-coded status badges + stale warnings), stale badge on side-by-side editor, reviewer comment field, EPUB pre-flight validation with warnings. The AI-anime recipe is COMPLETE and visually locked: sheet→frame→clip→voice→episode MP4 with real audio mix + manga page proofs + asset intelligence graph + experiment variations with promote-to-project + governed localization workflow with audit trail. 236 tests, 68/68 smoke, lint 0/0. All 6 artifacts per release (.deb, .dmg, .exe, .AppImage, .rpm, .apk). Next: Light Novel Pro slice 3 §9. Compact freely: this file carries the full state; after compaction ask 'read the Plan.md in the mirai-studio repo'.*
*Repository: https://github.com/yuaberry/mirai-studio*
*Website: https://yuaberry.github.io/mirai-studio*
