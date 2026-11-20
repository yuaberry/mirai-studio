/**
 * The warning shown BEFORE the user opts into a REMOTE local backend.
 *
 * The SD WebUI / ComfyUI API carries no authentication, so its address is a
 * credential. That is fine on 127.0.0.1 and on a personal tunnel whose URL is
 * a secret — and dangerous anywhere else. The app needs the user to make that
 * choice with their eyes open, in one honest paragraph, not buried in docs.
 */
export const REMOTE_LOCAL_WARNING =
  'The local backend API has NO authentication. Sending it a remote address means ' +
  'anyone who learns that URL can use that GPU (and read what it is asked to draw). ' +
  'Only use a URL that contains a SECRET you alone know, and shut the tunnel down ' +
  'when you finish.'

/** Where a free GPU actually lives today (Colab / HF ZeroGPU / a tunnel). */
export const REMOTE_LOCAL_PLACES = [
  { label: 'Google Colab (free T4 GPU)', url: 'https://colab.research.google.com' },
  { label: 'Hugging Face ZeroGPU Spaces', url: 'https://huggingface.co/zero-gpu' },
  { label: 'cloudflared tunnel (home GPU)', url: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/' },
  { label: 'ngrok tunnel (home GPU)', url: 'https://ngrok.com' },
] as const