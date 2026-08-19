# Bug 81 — an OpenAI-Compatible profile can never hold an API key

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-08-19 (v5 dogfood walk: trying to point an `OPENAI_COMPATIBLE` profile at a hosted OpenAI-compatible endpoint, to exercise the OAC tool path against something other than a local server) |
| **Severity** | Medium (a whole class of providers is unreachable; no data loss, nothing silently wrong — it simply cannot be configured) |
| **Who it bites** | anyone pointing Quilltap at a hosted OpenAI-compatible service that needs a bearer token — Together, Fireworks, Groq, DeepInfra, OpenRouter-alikes, a self-hosted vLLM/llama.cpp behind auth, or any corporate gateway. Local unauthenticated servers (llama.cpp, LM Studio, Ollama's OpenAI shim) are unaffected and work today |
| **Provenance** | Faithful-by-omission: the OAC plugin has declared `requiresApiKey: false` since it was written, and every key-related surface reads that one boolean as if it answered two different questions |
| **Defect site** | `plugins/dist/qtap-plugin-openai-compatible/index.ts:45` — `requiresApiKey: false`; `components/settings/api-keys/ApiKeyModal.tsx:68` — the Add-New-API-Key provider list is `providers.filter((p) => p.configRequirements?.requiresApiKey)`, so **OpenAI-Compatible is not offered and no such key can be created**; `components/settings/connection-profiles/ProfileModal.tsx:467` — the profile form renders the API Key selector only `if (reqs.requiresApiKey)`, and labels it `API Key *`, so even a key that existed would have nowhere to be attached |
| **v5 status** | **Faithful — v5 reproduces this exactly** (same dropdown contents, same absent field). No v5 fix is wanted before v4 moves; v5 will absorb the change in a drift catch-up |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

Create a connection profile with provider **OpenAI-Compatible**, give it the
base URL of a hosted service that requires a bearer token, and there is no way
to supply the token:

- the profile form shows **no API Key field at all** for that provider;
- Settings → API Keys → **Add New API Key** offers Anthropic, DeepSeek, Google
  Gemini, Grok (xAI), OpenAI, OpenRouter and Z.AI — **no OpenAI-Compatible
  entry**, so a key of that provider cannot be created in the first place.

The request then goes out unauthenticated and the endpoint answers 401.

## Root cause

One boolean, `configRequirements.requiresApiKey`, is being asked two different
questions:

1. *Must* this provider have a key before the profile is valid?
2. *May* this provider have a key at all?

For OpenAI-Compatible the honest answers are **no** and **yes** — it is the one
provider that legitimately spans authenticated and unauthenticated endpoints.
With a single flag, `false` is the only workable value (a `true` would break
every local llama.cpp/LM Studio user by demanding a key they do not have), and
`false` then silently removes the provider from both key surfaces.

Nothing below the UI has this problem. The data model already carries
`apiKeyId` on every connection profile regardless of provider, and both write
paths already validate the pairing —
`app/api/v1/connection-profiles/route.ts:230` and
`app/api/v1/connection-profiles/[id]/route.ts:227` return
`API key provider does not match profile provider`. So the plumbing for an
OAC key exists end to end; only the two UI gates that decide whether such a key
may be *created* and *shown* are missing.

## Why it survived

Every OAC profile anyone has actually built has pointed at localhost. The
keyless path works perfectly, so the gap only appears the moment someone aims
the provider at a hosted endpoint — which is exactly what a v5 dogfood walk
tried to do, and what the tester confirmed had never been tested
("I'm not sure I've ever tested the OpenAI-compatibility with an API key").

## The fix

Split the one flag into the two questions it is really answering. Concretely:

1. Add a second capability alongside `requiresApiKey` — `acceptsApiKey` (or
   `supportsApiKey`) — defaulting to the value of `requiresApiKey` so every
   existing plugin keeps its present behavior with no edit.
2. Set the OAC plugin to `requiresApiKey: false, acceptsApiKey: true`
   (`plugins/dist/qtap-plugin-openai-compatible/index.ts:45`). Ollama stays
   `false`/`false` — its endpoints are unauthenticated by definition.
3. `ApiKeyModal.tsx:68` filters on **`acceptsApiKey`**, so OpenAI-Compatible
   appears in the Add-New-API-Key provider list.
4. `ProfileModal.tsx:467` renders the API Key selector when
   **`acceptsApiKey`**, and drops the `*` from the label (and any required-field
   validation) when `requiresApiKey` is false — i.e. **the key becomes optional
   for OAC**: supply one for a hosted endpoint, leave it blank for a local one.

The server-side provider-match validation needs no change; it already does the
right thing once an `OPENAI_COMPATIBLE` key can exist.

⚠ The `requiresApiKey` flag is also read by
`lib/plugins/provider-validation.ts:108` (`requiresApiKey(provider)`, which
defaults to `true` "for safety") and by the Almanack's provider phase
(`lib/tools/almanack/phase2-machinery.ts:128,161`). Neither should change
meaning — they are asking question 1, which keeps its current answer. Only the
two UI gates move to question 2.

## Verification

- With no key attached, an OAC profile pointed at a local llama.cpp still works
  exactly as before (the regression that matters).
- An OpenAI-Compatible key can be created in Settings → API Keys.
- Attaching it to an OAC profile saves, and the outbound request carries
  `Authorization: Bearer …`.
- Detaching it saves too — the field is optional, not merely present.

## v5 coordination

v5 is faithful today and should stay that way until v4 moves; the v5 port then
absorbs the flag split and both UI gates in a drift catch-up. Recorded on the
v5 side in `docs/developer/porting/dogfood-walks/2026-08-19-owed-pass.md` (D6c).
