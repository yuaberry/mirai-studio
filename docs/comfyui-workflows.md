# ComfyUI workflows for anime — ready to paste

The app does not guess a vendor's node graph: you paste a **"Save (API Format)"**
workflow and it injects the studio prompt, the anime negative prompt, the seed
and (for video) your storyboard frame.

These are the two shapes the app drives, with the placeholders already placed.

---

## 1. Image (keyframes) — SDXL anime

Place into **Settings → Providers → image → "Your GPU"** → checkpoint Pony
Diffusion V6 XL / Illustrious / Anything V5, sampler `DPM++ 2M Karras`,
28 steps, CFG 7.

What the app sends for every keyframe:

```
{{prompt}}   the studio prompt (MEDIUM contract + STUDIO QUALITY REFERENCE +
            Style Bible + consistency lock + camera metadata)
{{negative}} ANIME_NEGATIVE_PROMPT (photorealistic, 3d render, live action…)
{{seed}}     a resolved seed
```

The prompt already contains, verbatim:

> **MEDIUM (non-negotiable): this is a 2D JAPANESE ANIME CEL-ANIMATION
> KEYFRAME** — hand-drawn animation as broadcast on Japanese television. It is
> NOT a photograph, NOT photorealistic, NOT a 3D render, NOT live action, NOT
> documentary, NOT a real person.

…and the **STUDIO QUALITY REFERENCE** naming CloverWorks (My Dress-Up
Darling), White Fox (Re:Zero), Studio Deen (KonoSuba), Toei, Kyoto Animation,
A-1 Pictures, Wit Studio, Ufotable — translated into outline, cel-shaded flat
colour blocks, expressive eyes, weight pose, painted backgrounds.

### Minimal reference graph (build this in ComfyUI, then Save API Format)

| Node | Type | Purpose |
|---|---|---|
| CheckpointLoaderSimple | load the anime `.safetensors` | |
| CLIPTextEncode (positive) | text = `{{prompt}}` | |
| CLIPTextEncode (negative) | text = `{{negative}}` | |
| EmptyLatentImage | 1344×768, batch 1 | |
| KSampler | 28 steps, CFG 7, `DPM++ 2M Karras`, seed `{{seed}}` | |
| VAEDecode + SaveImage | | |

The app talks to **A1111** for plain images (`/sdapi/v1/txt2img`), which needs
no workflow at all — the checkpoint, steps, CFG and sampler are configured in
Settings. Use ComfyUI when you want img2img chaining (the MALFOID lock: one
keyframe becomes the reference of the next).

---

## 2. Video — anime motion

Place into **Settings → Providers → video → "Your GPU"**.

| Placeholder | Replaced with |
|---|---|
| `{{prompt}}` | the studio prompt |
| `{{negative}}` | `ANIME_NEGATIVE_PROMPT` |
| `{{seed}}` | a resolved seed |
| `{{image}}` | the reference frame's file name **inside ComfyUI** (the app uploads it) |

The graph that works for anime, per model family:

| Family | Custom nodes | Clip length | VRAM |
|---|---|---|---|
| **AnimateDiff** | ComfyUI-AnimateDiff-Evolved | 16–32 frames | 8–12 GB |
| **Wan 2.2 / 2.5 / 2.7** | ComfyUI-WanVideoWrapper | 3–15 s | 12–24 GB |
| **LTXV** | built into recent ComfyUI | 3–15 s | 12–16 GB |
| **Hyper-SD** | ComfyUI-HyperSDXL | 3–15 s | 8–12 GB |

### The recipe that keeps the character locked

1. **Model sheet first** — Character editor → *AI sheet* (a turnaround of the
   character). This is the consistency anchor.
2. **Keyframe** — generate the storyboard frame with the model sheet as
   reference (`denoise` 0.55 keeps the design).
3. **Animate that keyframe** — image-to-video: `{{image}}` is the frame you
   just made. The clip inherits the design.
4. **Short cuts, many of them** — 2–3 s each. That is how anime disguises
   limited motion, and it is exactly where these models are strong.

---

## 3. What the app guarantees, and what it does not

**It guarantees:**
- the prompt forces the **anime medium** and excludes the unwanted media by
  name (a generalist model cannot drift to a photograph);
- the **negative prompt** is sent to the local backend;
- a shot that already has a clip is **skipped**, not regenerated, so an
  interrupted run resumes instead of starting over;
- a `PROVIDER_UNSUITABLE` refusal **before** an unusable GPU wastes your
  afternoon (it reads the backend's own VRAM).

**It does not guarantee:**
- broadcast quality. That is a function of the checkpoint, the LoRAs and the
  GPU you install — the app drives them, it does not conjure them.
- long video in one call. No model makes more than ~15 s; an episode is many
  clips, and the app tells you how many before it starts.

---

## 4. Free GPU (the honest route)

- **Google Colab** (free T4 16 GB): `docs/MiraiAnime-Colab.ipynb` — 5 cells,
  prints the public URL.
- **Hugging Face ZeroGPU Spaces**: same idea, your own Space.
- **Your own NVIDIA GPU**: run ComfyUI locally on `127.0.0.1:8188`.

Then: AI Marketplace → **"Your Own GPU"** → paste the URL → tick **"allow a
remote GPU"** → pick your checkpoint. Done.