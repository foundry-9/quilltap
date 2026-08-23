# qtap-plugin-nanogpt

NanoGPT provider plugin for Quilltap.

[NanoGPT](https://nano-gpt.com/) is a pay-as-you-go gateway that fronts
hundreds of upstream models behind one OpenAI-compatible API and one API key.
This plugin wires all three of its surfaces into Quilltap:

- **Chat** — `POST /api/v1/chat/completions` with streaming, tool calling,
  JSON response formats, reasoning display for routed thinking models, image
  attachments for vision-capable routed models, and prompt caching (implicit
  on OpenAI/Gemini routes; explicit opt-in via the profile's Prompt Caching
  options for Anthropic-routed models, sent as NanoGPT's body-level
  `promptCaching` helper). Cache reads are normalized into `cacheUsage` and
  excluded from billed prompt/total tokens.
- **Image generation** — the OpenAI-compatible images route
  (`POST /api/v1/images/generations`), base64 responses, with live model
  discovery via `GET /api/v1/image-models`.
- **Embeddings** — `POST /api/v1/embeddings`, with live model discovery via
  `GET /api/v1/embedding-models`.


## Image attachments

Since 1.1.0 the plugin serialises user-message image attachments as OpenAI
`image_url` content parts (JPEG, PNG, GIF, WebP), so a vision-capable routed
model — `deepseek/deepseek-v4-flash-vision-exp`, `zai-org/glm-4.6v`,
`z-ai/glm-4.5v` — actually receives the picture. Before 1.1.0 it inherited the
OpenAI-compatible base class's "not yet implemented" handling and dropped every
attachment on the floor (bug 91).

The plugin keeps **no list of which routed models have vision**, deliberately:
NanoGPT fronts hundreds of upstreams and such a list would be stale within the
week. The host has already decided by the time a request is built — attachments
only reach a profile whose `supportsImageUpload` flag is set, and when it isn't,
Quilltap's describe-fallback has replaced the bytes with text. An attachment
arriving at this plugin means the operator has asserted the model reads images;
the plugin's job is to send it and report honestly in `attachmentResults`.

## Configuration

Create an API key at <https://nano-gpt.com/api> and add it in Quilltap under
**Settings → API Keys** with the provider set to **NanoGPT**. The same key is
used by connection profiles (chat), image profiles, and embedding profiles.

## Model catalogs

NanoGPT's catalog is large and changes frequently, so the plugin prefers the
live listings and keeps only small curated static lists as fallbacks (see
`models.ts`). The `auto-model*` ids are NanoGPT's own routing meta-models and
are the most stable choices.

## Development

```bash
npm run typecheck   # tsc against plugins/tsconfig.base.json
npm run build       # esbuild bundle to index.js
```

Built as part of the main app's `npm run build:plugins`.
