# Roadmap

- **Phase 0 ✅ Foundation** — app shell, typed IPC, SQLite, projects/backups, job queue + recovery.
- **Phase 1 ✅ Creative Core (first slice)** — Story Bible, Characters, Locations, Episodes/Scenes
  with screenplay. *Remaining:* World Builder + chronology, relationships graph, costumes, props,
  typed screenplay elements, DAM + entity versioning, dockable panels, undo/redo.
- **Phase 2 ✅ AI Core (first slice)** — OpenRouter provider (chat/stream/models), registry,
  consent context, streaming AI Assist, model picker. *Remaining:* agents with tools + permissions
  + human-in-the-loop approvals, structured screenplay generation, project memory (FTS/summaries),
  cost dashboard, fallback chains.
- **Phase 3 — Storyboard (first slice ✅, v0.2.1)**: Storyboard Studio (shots with 10 framing
  types, lens presets, 10 camera movements, duration + scene runtime, reorder), REAL frame import
  (native dialog → images/assets inside the project → restricted `mirai-asset://` serving with
  path-escape protection and orphan pruning), Style Bible (Module 23, autosave).
  *Remaining:* Reference Board (infinite canvas), Character Consistency Engine (reference sets),
  image-generation provider contracts (wired when a real provider is configured — never faked).
- **Phase 4 — Media** — voice/TTS + music/SFX contracts, Subtitle Studio (SRT/VTT/ASS),
  image/video pipelines with capability detection, thumbnails/proxies.
- **Phase 5 — Editing** — Master Timeline (canvas), Audio Mixer, Compositing, Keyframes,
  configurable shortcuts, dock system.
- **Phase 6 — Render** — FFmpeg engine (queue/cancel/retry), bundled FFmpeg (licensing ADR),
  Export Center presets. **Gate:** the master flow → EXPORT MP4 end-to-end.
- **Phase 7 — Production** — tasks/approvals, versioning, QC reports, analytics.
- **Phase 8 — Advanced AI** — AI Director, Continuity Engine, multi-agent, workflow builder.
- **Phase 9 — Extensibility** — plugin API + SDK, marketplace foundation.
