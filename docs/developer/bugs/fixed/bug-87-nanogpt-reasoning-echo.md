# Bug 87 — NanoGPT's reasoning echo repeats the whole reply under a thinking fold

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-22) |
| **Found** | 2026-08-22 |
| **Fixed** | 2026-08-22 |
| **Severity** | Medium (every affected turn renders its full reply twice; nothing errors) |
| **Who it bites** | any NanoGPT chat turn the gateway routes through the echoing path — intermittent, observed back-to-back and then absent minutes later on identical requests |
| **Provenance** | Live (Friday dogfood, chat `fc2c875e-bebd-4b67-ad93-6f27cfcbe544`, messages `30057e70` and `7b9c96a0`) |
| **Fix site** | `plugins/dist/qtap-plugin-nanogpt/provider.ts` (`streamMessage` echo hold-back, `sendMessage` equality guard) — plugin 1.0.2 |
| **v5 status** | Not investigated — any v5 NanoGPT transport reading `delta.reasoning` inherits it; port the guard with the field |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-22).** Plugin `qtap-plugin-nanogpt` 1.0.2 holds back any
reasoning run that only ever replays the streamed prose verbatim from its
start; a run that diverges is real thinking and commits in full, one still
mirroring the prose at stream end is discarded. The non-streaming path drops
`message.reasoning` when it equals `message.content` exactly.

### Symptom

A NanoGPT turn (observed on `openai/gpt-5.5`) renders normally, then repeats
the **entire reply, byte for byte**, inside a thinking fold anchored at the end
of the message. In the DB the row carries `reasoningContent` identical to
`content` (2135 = 2135 chars on the pinned message) and one
`reasoningSegments` entry whose `anchorOffset` equals the content length.
Minutes later, an identical profile produced a turn with genuine reasoning
("**Exploring divergence and convergence** …", 688 chars) that rendered
correctly — the defect is routing-dependent on NanoGPT's side, not a
per-profile misconfiguration.

### Root cause

NanoGPT is a router, and on some routed paths its gateway **re-emits the
aggregated answer down the reasoning channel after the content stream ends** —
a trailing `delta.reasoning` carrying the full prose. The token accounting
proves it is a mechanical echo, not model output: the bad turn billed 746
completion tokens, enough for the 2135-char reply once, nowhere near twice.

Since plugin 1.0.1 (`d5830439`) taught `streamMessage` to read
`delta.reasoning` — correctly, it is the main endpoint's field and real
reasoning arrives there — the plugin faithfully accumulated the echo as
thinking. Core's pipeline then did exactly what it is told:
`applyReasoningChunk` recorded it, `flushReasoningSegment` at `done` anchored
it at the end of the prose, and the Salon displayed the reply twice.

### Why it survived

The field read was brand new (same-day commit) and the echo is intermittent:
five direct reproduction attempts against `nano-gpt.com/api/v1` with the same
model, sampling parameters, and tools all streamed either clean pre-content
reasoning or no reasoning at all. The two bites and the one clean turn sat
minutes apart in the same chat with no client-side change in between.

### The fix

In `streamMessage`, reasoning deltas that arrive once prose exists are held in
a `pendingReasoning` buffer while the accumulated run is still a prefix of the
streamed content (checked only while no real reasoning has been committed —
genuine pre-content thinking is untouched, since the prefix test requires
non-empty prose). The moment the run diverges from the prose it commits in
full, so no genuine thinking is lost; a run still mirroring the prose when the
stream ends is the echo and is dropped from the live yields, the final chunk,
and the synthesized `rawResponse` alike. `sendMessage` applies the degenerate
form: `message.reasoning` equal to `message.content` is discarded.

### How to verify

`npx jest __tests__/unit/plugins/nanogpt-reasoning.test.ts` — the suite pins
the trailing split-chunk echo (no chunk may surface it, `rawResponse` must
omit it), the diverging post-prose run (kept), the non-streaming equality echo
(dropped), and the pre-existing contracts (pre-content `delta.reasoning` and
legacy `reasoning_content` both still surface).
