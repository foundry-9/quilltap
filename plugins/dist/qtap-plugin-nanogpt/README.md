# qtap-plugin-nanogpt

NanoGPT provider plugin for Quilltap.

[NanoGPT](https://nano-gpt.com/) is a pay-as-you-go gateway that fronts
hundreds of upstream models behind one OpenAI-compatible API and one API key.
This plugin wires all three of its surfaces into Quilltap:

- **Chat** — `POST /api/v1/chat/completions` with streaming, tool calling,
  JSON response formats, and reasoning display for routed thinking models.
- **Image generation** — the OpenAI-compatible images route
  (`POST /api/v1/images/generations`), base64 responses, with live model
  discovery via `GET /api/v1/image-models`.
- **Embeddings** — `POST /api/v1/embeddings`, with live model discovery via
  `GET /api/v1/embedding-models`.

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
