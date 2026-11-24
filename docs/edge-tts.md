# Edge TTS — voz neural sem chave e sem expirar

O Mirai Studio usa os **serviços online de voz do Microsoft Edge** como
motor de voz **padrão**. Este documento é honesto sobre o que isso é, como
funciona e o que fazer quando falha.

## O que é

- **Hundreds of neural voices** (318 no dia em que isto foi escrito), uma
  por idioma/gênero — `pt-BR-AntonioNeural`, `ja-JP-NanamiNeural`,
  `en-US-EmmaMultilingualNeural`… — então **cada personagem pode ter a sua
  própria voz**, ao contrário de endpoints keyless de uma voz só.
- **Sem conta, sem chave, sem cartão.** O endpoint fala com o token público
  que acompanha todo navegador Edge (`6A5AA1D4EAFF4E9FB37E23D68491D6F4` —
  público por design).
- **Nada expira.** A autenticação é o header `Sec-MS-GEC`, derivado do
  **relógio**: `sha256` modificado + checksum CS64 dos ticks do Windows
  (segundos desde 1601, arredondados a 5 minutos) concatenados ao token
  público. Regenerado a cada request — não há sessão para renovar.

## Por que o token é derivado do relógio (e o que isso significa)

Um modelo de sessão (login → token com validade) **pode morrer**: o token
expira, o fluxo muda, o endpoint passa a exigir conta. O modelo do Edge não:
enquanto o relógio da máquina estiver certo, o token é sempre válido. O
preço é que **um relógio errado é rejeitado (403)** — por isso o cliente:

1. lê o header `Date` da resposta quando o serviço recusa;
2. corrige a defasagem medida (`adjustClockSkewSeconds`);
3. reenvia em uma **conexão nova** (token novo, connection id novo).

## Onde configurar

Settings → **Voice acting — who speaks**:

- **Edge neural (recomendado)** — o padrão. Seletor com o catálogo real
  (filtro por idioma), voz padrão por idioma da interface.
- **OpenAI-compatible** — seu próprio endpoint/chave (incluindo proxies
  ElevenLabs). Sem chave configurada, o app **cai para Edge** em vez de
  ficar mudo.
- **Google Translate** — o fallback keyless antigo (uma voz por idioma).

A voz de cada personagem fica em Characters → voice (qualquer nome do
catálogo Edge, ex. `pt-BR-FranciscaNeural`).

## Limitações honestas

- O endpoint é **não documentado** e **rate-limited**; uso pesado
  (episódios longos, muitos personagens) pode ser recusado. O cliente
  **retenta falhas transitóneas** (reset de socket, timeout) em conexão
  nova, até 3 vezes — e depois **falha alto com o motivo**, sem fingir voz.
- Sem internet: não há voz. O app diz isso; não inventa áudio.
- Pronúncia japonesa: as voices `ja-JP-*` são nativas; nomes ocidentais em
  SSML japonês podem soar estrangeiros — use a voz do locale do diálogo.
- A voz é refinada **localmente** pelo Mirai (cadeia ADR com FFmpeg:
  highpass → presence → body → compressor → reverb sutil → loudnorm
  -16 LUFS), então o resultado soa atuado, não lido.

## Como testar você mesmo

```bash
# catálogo + síntese real (precisa de internet)
cd apps/desktop
bun run e2e            # passo V39 do smoke faz a prova ao vivo
```

O smoke (`bun run verify`) inclui o passo **V39 EDGE TTS**: catálogo real +
síntese real + regeneração do token. Se a Microsoft estiver fora, o passo
**falha** — um suite verde sobre um motor de voz morto seria mentira.

## Implementação

| Arquivo | Papel |
|---|---|
| `packages/ai/src/edgeTts/token.ts` | o token v2 (port fiel, pinado por testes contra valores da implementação de referência) |
| `packages/ai/src/edgeTts/wss.ts` | socket WSS mínimo + codec de frames (sem dependência) |
| `packages/ai/src/edgeTts/provider.ts` | o protocolo (catálogo, SSML, síntese, retries) |
| `packages/ai/test/edgeTts.test.ts` | 30+ testes: token pinado, codec, protocolo, retries |