# Plugin manifest reference

`manifest.json` — validated strictly (zod, `PluginManifest` in
`packages/shared/src/entities/plugins.ts`). Invalid manifests are listed
but **locked** (can't be enabled).

```jsonc
{
  // slug, unique: ^[a-z0-9][a-z0-9-]{0,60}$
  "id": "my-plugin",
  "name": "My Plugin",
  // semver
  "version": "1.0.0",
  "description": "Optional, max 500 chars.",
  "author": "You <you@example.com>",

  // 1-6 of: READ | SUGGEST | EDIT | CREATE | DELETE | EXPORT
  "permissions": ["READ", "SUGGEST"],

  // Optional capabilities (all SUGGEST-gated):
  "commands": [
    {
      // namespaced: ^[a-z0-9][a-z0-9-]{0,60}(\.[a-z0-9][a-z0-9-]{0,60})$
      "id": "my-plugin.action",
      "label": "My Plugin: Do the thing",
      "description": "Shown as a tooltip."
    }
  ],
  "prompts": [
    {
      "category": "MANGA_PANEL", // MANGA_PANEL | CHARACTER | SCENE | ANIME_STYLE | NEGATIVE | STORY | UTILITY
      "title": "…",
      "body": "…",
      "tags": "comma, separated"
    }
  ],
  "exportPresets": [
    {
      "id": "my-preset",
      "label": "My Preset",
      "width": 1920, "height": 1080, "fps": 24,
      "videoKbps": 12000, "audioKbps": 192
    }
  ],
  "providers": [
    {
      "id": "my-chat",
      "label": "Community Chat",
      "kind": "chat", // chat | image | video — OpenAI-compatible endpoints
      "baseUrl": "https://api.example.com/v1",
      "model": "example/model",
      "notes": "Users Apply this in Settings + set their own key."
    }
  ]
}
```

## Rules of thumb

- Command ids **must be namespaced** by your plugin id.
- Providers are *declarations* — the app never auto-configures anything;
  the user clicks **Apply** and owns the API key.
- `index.js` is CommonJS; handlers receive the scoped `mirai` API only.
