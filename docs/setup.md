# Setup & troubleshooting

## Requirements
- **Bun ≥ 1.1** (workspaces, scripts, builds)
- Node ≥ 18 (only for the Electron binary installer script)
- Linux/Windows/macOS with a display (to run the app itself)
- Build tools (gcc/g++/make/python3) for the native SQLite rebuild

## Fresh install

```bash
bun install
node apps/desktop/node_modules/electron/install.js   # if electron dist/ is missing
bun run rebuild:native                                # compile better-sqlite3 for Electron
bun run verify
bun run dev
```

## Troubleshooting

### `Cannot find module .../electron/install.js` (or `dist/` missing)
Bun does not always run Electron's postinstall: `node apps/desktop/node_modules/electron/install.js`.

### App opens blank / `better-sqlite3` NODE_MODULE_VERSION error
Wrong ABI: `bun run rebuild:native`. The same check runs in-app: Diagnostics → Native SQLite.

### Core tests fail with module load errors
They must run under Electron's Node (ABI): `bun run test:core`
(`ELECTRON_RUN_AS_NODE=1 electron … vitest run`).

### `ffmpeg` shown as "Not found" in Diagnostics
Only *detected* on PATH; needed from Phase 6 (render/export). Ignore for now.

### Where is my data?
- App data: OS userData dir (`~/.config/<app>/` on Linux) — `app.sqlite`, `logs/`, `backups/`.
- Projects: wherever created (default `~/Documents/MiraiProjects`).
- Diagnostics → "Data folder" shows the path; "Open Logs Folder" reveals rotating JSONL logs.

### Credentials show "Stored unencrypted"
OS keychain (`safeStorage`) unavailable — Linux usually needs a keyring service
(`libsecret`). Mirai tells you instead of pretending (ADR D06).

### AI Assist says "No model selected"
Settings → AI → pick a default model from the live catalog (works even before
adding a key — discovery is public; chat needs the key).

### Something else
1. Diagnostics — filterable log stream (levels/categories).
2. Command palette → "Reveal Logs Folder".
3. File an issue with a `mirai.log` excerpt.
