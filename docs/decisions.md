# Decision records (ADR)

- **D01 Electron** — TS backend everywhere; `safeStorage`, `worker_threads`, native modules.
- **D02 better-sqlite3 + versioned SQL migrations** — raw SQL typed at zod boundaries; one runner
  serves App DB and every Project DB; ORM can arrive later behind services.
- **D03 Tests under Electron's Node** — `ELECTRON_RUN_AS_NODE=1` eliminates ABI drift.
- **D04 Own LoggerService** — ring buffer + synchronous rotating files (async stream racing a
  rename silently loses files — caught by a test).
- **D05 Typed IPC contract table** — zod on request AND response; renderer client fully typed.
- **D06 Credentials are write-only from the UI** — no `credentials:get` channel exists.
- **D07 Jobs persist per project** — portability + scoped recovery; open() auto-recovers PAUSED.
- **D08 Cancelled RUNNING jobs are CANCELLED, never retried** — caught by tests.
- **D09 AI transport is an injected port** — provider is fully testable offline; the main process
  wires `global fetch`.
- **D10 Built-in prompts use deterministic ULID-shaped ids** (sha256 of slug → Crockford base32)
  so seeding is idempotent and schema-valid.
- **D11 npmRebuild: false in packaging** — the native module is compiled by `rebuild:native`
  against Electron's ABI; the builder just ships it (asarUnpack). Boot-testing the packaged
  binary caught a missing runtime dep (`bindings`) before it ever reached a user.
- **D12 External backup after every milestone** — a workspace loss incident (v0.1.0) taught us:
  code outside git's directory needs a tarball outside the directory too.

- **D13 mirai-asset:// custom protocol** — frames are served by the main process through a
  restricted scheme (asset id → validated path inside the open project). No renderer path
  access, no directory traversal; plain `<img src>` works. Replaces data-URL IPC round-trips
  and is the foundation for the Phase 4 DAM.
- **D14 Frames are imported files, not generated placeholders** — Phase 3 ships a REAL
  image pipeline (validate → copy → registry → prune orphans). AI image generation gets its
  provider contracts only when a real provider is wired (spec §51: never fake the button).
