# Packaging

```bash
bun run rebuild:native
bun run icons              # icon set from build/icon.svg (sharp/librsvg)
bun run package:linux      # .deb + AppImage in apps/desktop/release/
```

Install: `sudo apt install ./mirai-studio_0.2.0_amd64.deb` → `mirai-studio`
(auto-resolves libgtk-3-0, libnss3, libsecret-1-0…; Section: graphics; icons 32→512 hicolor).

Release checklist: `bun run verify` → `rebuild:native` → `package:linux` → **boot-test the
packaged binary** (`timeout 30 release/linux-unpacked/mirai-studio` — must reach window stage
with no module errors) → `dpkg-deb -f/-c` inspection → external backup tarball.

Windows NSIS config is ready (`win.target: nsis`) — build on Windows or via wine.
