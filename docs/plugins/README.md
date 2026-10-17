# Mirai Studio Plugin SDK

Mirai Studio is extensible locally: a plugin is a **folder** with a strict
`manifest.json` (+ optional `index.js`) that you install from the
**Plugins** page. No store account, no telemetry — your machine, your rules.

## What plugins can contribute

| Capability | Manifest key | Gating permission |
|---|---|---|
| Command palette commands | `commands` | `SUGGEST` |
| Prompt Library entries | `prompts` | `SUGGEST` |
| Export Center presets | `exportPresets` | `SUGGEST` |
| **Providers** (chat/image/video endpoints) | `providers` | `SUGGEST` |

## The permission model

Declared in the manifest, **enforced at every API call** inside the host:

| Permission | Grants |
|---|---|
| `READ` | Project summary (name, counts, missing-screenplay list — never paths/secrets) |
| `SUGGEST` | Contribute commands, prompts, presets, provider declarations |
| `EDIT` | Edit existing entities |
| `CREATE` | Create entities |
| `DELETE` | Delete entities |
| `EXPORT` | Trigger renders/exports |

A plugin calling an API it didn't declare throws a validation error — see
`apps/desktop/src/main/plugins/pluginHost.ts` (`requirePermission`).

## Installing

1. Build a folder: `manifest.json` + (optional) `index.js`.
2. Plugins page → **Install from folder…**
3. **Enable** it — capabilities light up (palette, Prompt Library, Export
   Center, Providers with an **Apply** action that writes the declared
   endpoint into Settings; the API key is always yours to set).

## Publishing (marketplace foundation)

Host your folder anywhere (GitHub repo, zip). Open a PR adding an entry to
`CURATED_MARKETPLACE` in `packages/shared/src/entities/plugins.ts` —
`id`, `name`, `description`, `author`, `permissions`, `source`
(e.g. `github:user/repo`). The registry is curated; installation stays
local-first.

## Manifest reference

See [MANIFEST.md](./MANIFEST.md). Validate locally:

```bash
bunx tsx -e "const {PluginManifest}=require('@mirai/shared');console.log(PluginManifest.safeParse(require('./manifest.json')).success)"
```

## The command handler API (`index.js`)

```js
module.exports = {
  commands: {
    'my-plugin.hello': async (mirai) => {
      const project = mirai.project() // needs READ
      return { message: `Hello ${project?.name ?? 'world'}!` }
    },
  },
}
```

Result objects with a `message` field surface as a toast. Anything the
`mirai` API doesn't expose is inaccessible by design — file a feature
request instead of reaching around it.
