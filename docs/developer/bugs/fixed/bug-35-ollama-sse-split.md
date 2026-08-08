# Bug 35 — the Ollama SSE splitter drops JSON split across reads

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low |
| **Who it bites** | Ollama streaming |
| **Provenance** | Faithful |
| **Fix site** | `plugins/dist/qtap-plugin-ollama/provider.ts` — cross-read `buffer` + final-tail flush |
| **v5 status** | **Owed** (Faithful) — mirror the cross-read buffer; retire the Rust-side boundary-sensitivity test |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: Low.** **FIXED in v4 (2026-08-06).**

### Root cause

The Ollama stream decoder splits each network read on `\n` with **no cross-read
buffer**, so a JSON object that straddles two network reads is silently lost —
occasional dropped content on Ollama streaming, by design of the splitter. v5
reproduces the boundary-sensitivity (Rust-side unit test).

### The fix

`OllamaProvider.streamMessage` now carries the trailing partial line in a
`buffer` between reads (`buffer.split('\n')`, keep the last fragment) and flushes
any final non-empty tail at stream end — an unparseable tail is logged at debug,
not warn. Fix site: `plugins/dist/qtap-plugin-ollama/provider.ts`.
