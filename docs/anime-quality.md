# Anime Quality — generating at Japanese-studio level, for FREE

This document is the honest answer to *"I want it to look like Re:Zero / My
Dress-Up Darling / KonoSuba, and I don't want to pay anything."*

It has three parts:

1. **What was wrong** — why the free stack produced photorealistic output.
2. **What the app now does** — the anime contract that is enforced in code.
3. **How to get the quality** — the local GPU path (zero cost), and the paid
   cloud path, with the real requirements for each.

---

## 1. What was wrong (measured, not assumed)

The keyless free stack is:

| Capability | Provider | Measured behaviour |
|---|---|---|
| Chat / script | NVIDIA NIM | Real, works |
| Image | Pollinations classic (`flux`) | **GENERAL model** — photorealistic/live-action output, logo-stamped |
| Video | Pollinations media (`wan-2.2-fast`) | **24/24 models `paid_only`** → HTTP 401 without a key |
| Voice | Google Translate speech | Real MP3, one voice per locale |

`flux` is **not an anime model**. It has no cel-shading, no anime lineart, no
broadcast palette, no anime proportions. Asking it for "anime style, beautiful,
high quality" produces *a beautiful photograph* — because that is what the model
knows how to make. Measured from the E2E frames: skin texture, lens bokeh,
depth-of-field blur, photorealistic hair — every marker of a camera photo.

**No prompt can fix this.** Adjectives compete with a model's entire training
distribution. Naming the *medium* and *excluding the unwanted media by name* is
what works.

---

## 2. What the app now enforces (in code, not in a README)

### The MEDIUM CONTRACT — `buildImagePrompt()`

Every image prompt now carries a non-negotiable medium statement:

```
MEDIUM (non-negotiable): this is a 2D JAPANESE ANIME CEL-ANIMATION KEYFRAME —
hand-drawn animation as broadcast on Japanese television. It is NOT a
photograph, NOT photorealistic, NOT a 3D render, NOT live action, NOT
documentary, NOT a real person. Nothing that looks like a camera photo.
```

The unwanted media are **named and excluded**. A generalist model then has
nowhere to drift to.

### The STUDIO QUALITY REFERENCE

The prompt names the production language of the studios that set the bar:

> CloverWorks (My Dress-Up Darling), White Fox (Re:Zero), Studio Deen
> (KonoSuba), Toei Animation, Kyoto Animation, A-1 Pictures, Wit Studio,
> Ufotable.

…and translates it into the terms these pipelines actually understand:

- clean confident **outline** (variable line weight, ink-like, no sketchy strokes)
- **flat cel-shaded** colour blocks with hard shadow edges
- crisp bright anime palette with a defined key palette
- large expressive eyes with clean highlight shapes
- stylised hair as defined shapes with specular bands
- simplified expressive faces, anime proportions
- painted background with atmospheric depth and bokeh
- intentional **pose** with weight and gesture (not a static snapshot)

### The ANIME NEGATIVE PROMPT

Exported as `ANIME_NEGATIVE_PROMPT` and sent verbatim as `negative_prompt` to
the local backends. It excludes, by name: `photorealistic, realistic, photo,
photograph, 3d render, cgi, live action, real person, DSLR, film grain,
documentary, sketch, pencil, unfinished, monochrome…` plus the usual quality
traps (`bad anatomy, extra limbs, deformed hands…`).

> Measured: the same SDXL checkpoints drift to live-action photography within a
> few steps unless the unwanted medium is named **exclusively**.

### Locked by tests

`packages/ai/test/consistency.test.ts` fails the build if the prompt ever
regresses to "beautiful image" without the medium contract, the studio
references, or the exclusion list.

---

## 3. Getting the quality

There are two routes. **Neither is free *and* instant** — that combination does
not exist for this quality bar, and this document will not pretend otherwise.

### Route A — your own GPU (zero recurring cost)

This is the **only** route with no invoice, and the app is now built for it.

**Requirements**

| Component | Minimum | Recommended |
|---|---|---|
| GPU (NVIDIA) | 8 GB VRAM (image) | 12–24 GB VRAM (video) |
| CUDA | 11.8+ | 12.x |
| System RAM | 32 GB | 64 GB |
| Disk | 100 GB SSD | 500 GB NVMe |
| OS | Linux (Ubuntu recommended) | Linux with NVIDIA drivers installed |

> **A VM with GPU counts.** Cloud GPU instances (RunPod, Lambda, Vast.ai…)
> satisfy this — they just bill by the hour. Free-tier VMs do **not** include
> usable NVIDIA GPUs for this workload.

**Install Automatic1111 (images)**

```bash
git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui
cd stable-diffusion-webui
# The app calls the API — it MUST be enabled:
./webui.sh --api --listen     # then keep it running on port 7860
```

Load an **anime checkpoint** — the quality depends on the model you choose, not
on a cloud tier. The current industry references:

| Model | Notes |
|---|---|
| **Pony Diffusion V6 XL** | Strongest general anime; excellent prompt adherence |
| **Illustrious** | The modern successor line; very clean lineart |
| **Anything V5** | Classic, lightweight, easy to run on 8 GB |
| **Counterfeit** | Anime + illustration hybrid |
| **Animagine XL** | Good for character design sheets |

Download from Civitai and drop the `.safetensors` into
`models/Stable-diffusion/`.

**In Mirai Studio**

1. Open **AI Marketplace** → pick **"Your Own GPU (Automatic1111)"**.
2. The app sets `protocol: local` and the address `http://127.0.0.1:7860`.
3. Generate frames. They come back **without any vendor logo** (`watermarked`
   is `false` — a measured fact, because there is no vendor).

> **Security:** the adapter **refuses any non-loopback address**. The SD WebUI
> API is unauthenticated by design; exposing it would leak your GPU to the
> network. `127.0.0.1` / `localhost` / `[::1]` only.

**Install ComfyUI (video)**

```bash
git clone https://github.com/comfyanonymous/ComfyUI
cd ComfyUI
python main.py --listen       # runs on port 8188
```

Video needs a **workflow** — the app does not guess node layouts. Build one for
AnimateDiff / Wan 2.2 / LTXV / Hyper-SD, then use **Save (API Format)** and
paste the JSON into **Settings → Providers → Video (local)**.

The adapter injects these placeholders into your workflow:

| Placeholder | Replaced with |
|---|---|
| `{{prompt}}` | the studio prompt (positive prompt) |
| `{{negative}}` | `ANIME_NEGATIVE_PROMPT` |
| `{{seed}}` | a resolved seed |
| `{{image}}` | the reference frame's file name inside ComfyUI |

Because the workflow is yours, **any** video model works — the app never has to
know a vendor's graph.

**Runtime expectations (honest)**

- Image: a few seconds to ~30 s per keyframe on a modern GPU.
- Video: minutes per clip, and it scales directly with resolution/frames. A
  3-second 1080p clip can take 10+ minutes on a 12 GB card.

### Route B — paid cloud APIs (no GPU of your own)

For when you want the quality but not the hardware. The app already speaks the
OpenAI-compatible protocol, so a vendor that offers `/images/generations` or
`/videos/generations` needs no new code:

1. **AI Marketplace** → **Custom OpenAI-compatible (Image)** or **(Video)**.
2. Paste the base URL and model in **Settings → Providers**.
3. Add the API key in the credential vault.

Vendors in this category include Fal.ai / Replicate aggregators and the video
specialists (Kling, Seedance, Hailuo, Wan 2.2 hosted, LTXV hosted). The app
does not endorse any specific one — and the Marketplace card states plainly
that watermark-freedom depends on the vendor you choose.

**Do not expect a free API tier of these.** The ones that exist are trials of
minutes or a handful of generations — not a production pipeline.

### The anime video models that exist TODAY (verified live)

The app reads the vendor's live catalog — nothing is invented. Fetched from
`https://gen.pollinations.ai/video/models`, these are the **25 video models**
that are reachable through Mirai Studio right now via the Pollinations adapter:

| Model | Best for (anime pipeline) |
|---|---|
| `alibaba/wan-2.2-fast` | **Fast 5 s draft** — the quickest way to preview a shot |
| `alibaba/wan-2.6` | 720p with sound, from a starting image |
| `alibaba/wan-2.7` | **Wan 2.7** — opening/closing images + visual references, with sound |
| `alibaba/wan-3.0` | The newest Wan — images, video or audio references |
| `bytedance/seedance-2.0-fast` | Quick 4–5 s clips from opening/closing images |
| `bytedance/seedance-2.0-mini` | 10 s clips, opening/closing image control |
| `bytedance/seedance-2.0` | 720p with synchronized sound + reference images |
| `bytedance/seedance-2.5` | 4 s with synchronized sound + reference frames |
| `kwaivgi/kling-v3.0-std` | **Kling 3.0** — the sakuga leader: dynamic motion, camera orbits, impact frames |
| `minimax/minimax-h3-max` | **Hailuo-class** — 5 s with stereo sound, physics-aware |
| `minimax/minimax-h3-max-turbo` | 15 s fast drafts from opening/closing images |
| `minimax/h3` | Text/scene → 5 s with synchronized stereo sound |
| `x-ai/grok-imagine-video` | 720p up to 15 s with synchronized sound |
| `x-ai/grok-imagine-video-1.5` | Opening image → video with synced sound |
| `x-ai/grok-imagine-video-1.5-lite` | Fast 1080p draft from text or image |
| `google/veo-3.1-fast` | Fast short clips, opening/closing image control |
| `google/gemini-omni-1.2-flash` | **15 s with synchronized sound at up to 4K** |
| `google/gemini-omni-1.1-flash` | 10 s with synchronized sound, up to 4K |
| `black-forest-labs/flux-3-max` | Up to 20 s with optional sound + control |
| `kandinskylab/kandinsky-6.0-lite` | Animates an opening image, 5 s clips |
| `heygen/heygen-video-1` | Text/opening image → video **with dialogue** (lip-sync use) |
| `prunaai/p-video` | Description/opening image → 720p or 1080p |
| `alibaba/happyhorse-1.1` | Text/opening image → 720p up to 15 s |
| `alibaba/wan-2.6` | 720p with sound from a starting image |
| `mirelo/sfx-2.0` | Adds matched sound effects to an existing video |

**Every one of them is `paid_only: true`.** They are all already selectable in
the Marketplace → Live models tab, and the adapter already speaks the protocol.
Adding the vendor key turns them on — no code change needed.

**The anime pipeline that uses them:**
1. Generate the **keyframe** first (local GPU, or a paid image model).
2. Pick **one** video model as the animator.
3. Send the keyframe as the opening image → image-to-video keeps your
   character design locked.
4. For dialogue: generate the voice first (`ai:speakShot`), then a
   dialogue-capable model like `heygen/heygen-video-1` can carry it.

### What Route C is *not*

There is no Route C. Specifically:

- **No free cloud API** serves Pony Diffusion / Illustrious / Wan 2.2 at
  production quality and scale.
- **No free GPU tier** exists for sustained video generation.
- **CPU-only generation** is not viable for this workload (hours per clip).
- **The keyless Pollinations tier** can validate the *pipeline* (script,
  storyboard, consistency, voice, timeline, render, dossier) but **cannot**
  deliver studio-grade *visuals* — it serves a general photorealistic model
  with a logo.

---

## 4. Quality checklist

Before blaming the pipeline, check these in order:

1. **Is `protocol` actually `local`?** Settings → Providers. If it still says
   `pollinations`, you are on the model that cannot do this.
2. **Is the backend running and reachable?** The app reports
   "Could not reach the local generator" with the address it tried.
3. **Is the checkpoint an anime model?** A photorealistic checkpoint
   (`realisticVision`, `DreamShaper`…) will undo every instruction in the
   prompt. Check the A1111/ComfyUI console for the loaded model.
4. **Is the negative prompt reaching the model?** The local route sends
   `ANIME_NEGATIVE_PROMPT` automatically; a custom sampler may ignore it.
5. **Character consistency** comes from the model sheet + reference frame —
   generate the character's turnaround sheet FIRST (`AI sheet` in the Character
   editor), then generate shots with it as the image-to-image reference
   (`denoise` 0.55 keeps the design lock).

---

## "I don't own a big GPU." — the FREE GPU routes

You do not need to buy a GPU. A free one is available today, and the app can
drive it. These are the three real routes, in the order that costs least:

| Route | Cost | What you get | How the app connects |
|---|---|---|---|
| **Hugging Face ZeroGPU Spaces** | Free | A shared NVIDIA GPU in a Space you own | Open your Space, start it, copy its URL |
| **Google Colab** | Free (T4, ~12 h/day) | A real T4 16 GB in a notebook | Run ComfyUI/A1111 in the cell, tunnel it |
| **cloudflared / ngrok to a home GPU** | Free (you own the card) | Your own 12 GB+ card, anywhere | Run the tunnel, paste the URL |

### The one thing the app needs you to decide

Those backends listen on a **remote address**, and their HTTP API has **no
authentication**. So the app refuses a non-loopback address **by default** and
requires an explicit opt-in:

> The local backend API has NO authentication. Sending it a remote address
> means anyone who learns that URL can use that GPU (and read what it is asked
> to draw). Only use a URL that contains a SECRET you alone know, and shut the
> tunnel down when you finish.

Enable it in **Settings → Providers → (image or video) → "Your GPU" → allow a
remote GPU**. The warning is printed on the same panel, before you check it.

**Rule of thumb:** a Colab/ZeroGPU/tunnel URL is long and random *because it is
the password*. Never post it, never commit it, shut it down when done.

### Colab, in four steps

1. Open a new Colab notebook → **Runtime → Change runtime type → T4 GPU**.
2. Install the backend (one cell):
   ```bash
   !git clone https://github.com/comfyanonymous/ComfyUI && cd ComfyUI
   !pip install -r requirements.txt
   ```
3. Load an anime checkpoint into `models/checkpoints` (see the list in §3).
4. Start it with a public URL (another cell):
   ```bash
   # A1111 image path:
   !./webui.sh --api --share --gradio-auth user:pass
   # ComfyUI path (needs the tunnel):
   !python main.py --listen & cloudflared tunnel --url http://localhost:8188
   ```
5. Paste the resulting URL into Settings → Providers → Base URL, and tick the
   remote opt-in.

### Why this reaches the reference frames' quality

The frames in the trend you pointed at are consistent because their creator
used **a reference sheet + image-to-video from it**. That is exactly the path
the app drives: `Character sheet (turnaround)` → `keyframe` →
`image-to-video with the keyframe as reference` → voice → subtitle → render.
The MALFOID LOCK step of the E2E measures that lock end-to-end (it scored 100).

What still separates it from a CloverWorks broadcast is *directing and scale*,
not the pipeline — see §5.

---

## "Will my computer freeze?" — the app answers BEFORE it happens

The most expensive mistake in this pipeline is starting a generation the machine
cannot finish. An hour later nothing is done and the laptop is unusable.

So the app runs a **preflight** and refuses with an actionable message:

| Capability | Minimum VRAM | Why |
|---|---|---|
| Anime image | **6 GiB** | SDXL-based anime checkpoints (Pony V6 XL, Illustrious) |
| Anime video | **12 GiB** | Wan 2.2 / AnimateDiff / LTXV |

The check reads the backend's own GPU inventory (ComfyUI `/system_stats`), so
the number is **measured, never assumed**. When the GPU is too small the app
says:

> This machine's GPU has 2.0 GiB of VRAM, but anime VIDEO generation needs
> about 12.0 GiB. Generating would take hours and make the machine unusable —
> the app refuses instead. Options: use a cloud video provider (Marketplace →
> video model + key), or run the local backend on a machine with a larger
> NVIDIA GPU.

And it offers the cloud path right there in the same panel.

**Where you see it:** Settings → Providers → (image or video) → the "Your GPU"
panel shows the GPU, free/total VRAM, and the refusal before you spend the
afternoon. The image panel also lists the checkpoints your backend actually has
installed, read live — so you pick from models you really own, never a
hardcoded list.

### A concrete reading (this dev machine, measured)

| Component | Value |
|---|---|
| GPU | Intel Haswell iGPU + NVIDIA GeForce GT 740M |
| VRAM | **2 GiB** (and no NVIDIA driver loaded) |
| System RAM | 7.7 GiB (2 GiB swap) |
| CPU | 4 threads (Haswell era) |

**Verdict: anime VIDEO generation is impossible here, and anime image
generation with SDXL is impractical.** The preflight refuses, and it is right to.
For this workload the honest options are: a machine with a real NVIDIA GPU
(12 GB+), a cloud GPU rented by the hour, or a cloud API with a key.

**A GT 740M / 2 GiB cannot be fixed with settings.** No workflow, checkpoint or
offload trick turns 2 GiB into 12 GiB — the app refuses rather than pretend.

---

## 5. Long episodes: the free motion path

A long episode needs one motion clip per shot. Every free vendor model of
video is paid-only, and generation quality is a GPU problem — so a
zero-cost long episode is a **camera-move** problem, which FFmpeg solves
deterministically:

- Every storyboard frame the shot has gets a REAL clip with a real camera
  move — push-in, pull-back, pan, tilt, diagonal drift, subtle handheld —
  rendered by `zoompan` (Storyboard → shot → **Camera move (free)**, or
  Episodes → **Camera moves (free)** for the whole episode).
- **One clip per shot** replaces the 2–4 model generations that shot would
  otherwise need — the animatic before animation, exactly as a real studio
  works.
- The clip follows the shot's OWN camera movement field (STATIC/PAN/
  DOLLY_IN…): what the user wrote is what the engine executes.
- When the user does have a video key (or a local ComfyUI), the same
  keyframe is the image-to-video reference — consistency comes from the
  frame, motion from the provider.

This is not a substitute for animated footage; it is the honest free path
to a watchable cut, and the app never pretends otherwise.

## 6. Honest limitations

- **No provider is guaranteed "watermark-free"** — the Marketplace reports the
  *measured* fact per provider. Local generation has no vendor logo because
  there is no vendor.
- **Voice on the keyless path** is Edge's neural catalog (hundreds of voices,
  one per character) — see `docs/edge-tts.md` for the auth model and the
  honest failure modes. The legacy Google endpoint (one voice per locale)
  still exists for when Edge is unreachable.
- **Consistency score 100** means the prompt honoured the lock, not that two
  independent generations are pixel-identical. Lock characters with model
  sheets + reference frames for that.
- **The final render is local FFmpeg** — deterministic, licensed, already
  bundled. Generation is the cloud/GPU step; encoding is not.