# Bug 124 — a help chat's tool results never reach the model on most providers, so a question that needs a tool ends in silence

| | |
|---|---|
| **Status** | **Open — UNCONFIRMED on live v4.** Found on the v5 port's dogfood copy of Friday (2026-09-06); the v4 side is established by reading the shipped code, not by a live run. One live gesture confirms or refutes it (see Verification). |
| **Found** | 2026-09-06 |
| **Fixed** | — |
| **Severity** | **Medium** (nothing errors and nothing is lost — the Help dialog simply shows *nothing* after a question that makes the character reach for `help_search` or `help_navigate`: the tools run, every model turn comes back empty, the duplicate-call guard ends the loop, and no assistant row is written. On a GOOGLE seat the same question works, which is what makes it look like the character's mood rather than a defect) |
| **Who it bites** | any help chat whose answering character sits on OpenAI, Anthropic, OpenRouter, Grok, Ollama, DeepSeek, NanoGPT or Z.AI — i.e. every seat but a Google one — the moment the question needs a tool |
| **Provenance** | Live on the v5 port (Friday copy, chat `37c6289c…`, Riya on NanoGPT: *"Where do I change the app's theme? Take me there."* → 8 empty ASSISTANT turns, 10 TOOL rows, the guard at turn 9, an EMPTY forced final, nothing on screen; repeated on chat `ff942ee4…` with three identical `help_search` calls). v4's shape is read from source: the help loop's tool rows and the plugins' guards are quoted below. |
| **Defect site** | `lib/services/help-chat/orchestrator.service.ts:509` (the tool-result row is pushed as `{ role: 'tool', content }` with **no `toolCallId`**) meeting `plugins/dist/qtap-plugin-nanogpt/provider.ts:174` `if (!msg.toolCallId) continue;` and the same guard in the deepseek, z-ai, openai (`:94`), grok (`:93`), anthropic (`:174`), openrouter (`:180`) and ollama (`:107`) plugins. Only `qtap-plugin-google/provider.ts:377-388` keeps an id-less tool row (`functionResponse` named `unknown_function`). |
| **v5 status** | **Reproduces faithfully** (the per-provider drop was ported deliberately at the `p4.9i2` unification, GOOGLE keeping the row). v5 will absorb v4's fix at the next drift catch-up; dogfood finding #112. |
| **Index** | [bugs.md](../bugs.md) |

---

### Symptom

Open the Help dialog, pick a character seated on NanoGPT (or any non-Google
provider), and ask something the character must look up — *"Where do I change
the app's theme? Take me there."* The tool calls fire (`help_search`, then
`help_navigate`, then `help_search` again with the same query), every assistant
turn between them is empty, and after the third identical call the
`MAX_DUPLICATE_TOOL_CALLS` guard (`:432`) forces a final response — which is
also empty. `if (fullResponse)` at `:533` then writes nothing, and the dialog
shows nothing at all. On a Google seat the same question is answered and the
navigation button appears.

### Root cause

The help orchestrator runs its own agent loop rather than the Salon's native
tool loop. When a tool has run, it pushes the result back into the message list
as

```ts
{ role: 'tool', content: toolResultContent }          // :509
```

with no `toolCallId`. Every provider plugin except Google refuses to forward a
tool row without one — the OpenAI/Grok plugins log *Skipping tool message
without toolCallId*, the Anthropic/OpenRouter/Ollama plugins filter them out,
and the DeepSeek/NanoGPT/Z.AI plugins `continue` past them. So on those
providers the model sees its own (empty) assistant turn followed by the user's
question again, never the search result, and asks again. The Google plugin
wraps an id-less row as a `functionResponse` named `unknown_function`, which is
why a Google seat answers.

### Why it survived

The Salon's native loop threads ids (`lib/services/chat-message/tool-call-threading.ts:94`),
so the plugins' guards never fire there; the help loop is the one caller that
does not. The help-chat jest suite mocks `streamMessage` above the plugin, so
it never sees the drop. And the failure mode is silence — an empty dialog reads
as the character having nothing to say.

### The fix

Thread the id: keep the `toolCallId` from the detected call (`:297` already
declares it on the local type) and push `{ role: 'tool', toolCallId, content }`
at `:509`, the way `tool-call-threading.ts` does for the Salon. Alternatively,
splice the tool result as text into the next user turn — the pattern the
pseudo-tool path uses — but the id is the honest fix.

### Verification

Live, on this instance: ask Riya the question above in the Help dialog. Before
the fix: an empty reply and TOOL rows in `chat_messages` with empty ASSISTANT
rows between them. After: a streamed answer citing the found document and a
navigation button. A unit pin: drive `processHelpResponse` with a mocked plugin
that records the `messages` it receives and assert the `tool` row arrives with
a `toolCallId`.
