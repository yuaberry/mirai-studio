/**
 * Edge TTS — keyless neural voices that cannot expire (v2.1).
 * See token.ts (the clock-derived auth), wss.ts (the socket + codec) and
 * provider.ts (the protocol on the wire).
 */
export {
  TRUSTED_CLIENT_TOKEN,
  CHROMIUM_FULL_VERSION,
  SEC_MS_GEC_VERSION,
  WIN_EPOCH,
  generateSecMsGec,
  generateSecMsGecV2,
  adjustClockSkewSeconds,
  parseHttpDate,
  sha256Digest,
  sha256Init,
  buildSeedWords,
} from './token'
export {
  WssFrameParser,
  buildHandshakeRequest,
  encodeClientFrame,
  splitHeadersAndData,
  createTlsSocket,
  sha256Hex,
  type WssSocket,
  type WssFrame,
  type WssSocketFactory,
} from './wss'
export {
  edgeSpeak,
  listEdgeVoices,
  buildSsml,
  buildConfigMessage,
  buildSsmlMessage,
  edgeWssUrl,
  escapeXml,
  sanitizeText,
  jsTimestamp,
  wssHeaders,
  voicesHeaders,
  type EdgeTtsOptions,
  type EdgeTtsResult,
  type EdgeVoice,
} from './provider'
