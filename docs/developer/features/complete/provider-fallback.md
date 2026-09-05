# Provider/model fallback chains

**Status:** implemented (2026-08-29). Shipped as described below, with the
deviations recorded in "As built" at the foot of this document.
**Decided with the human (2026-08-29):**

1. Fallback configuration lives **on the connection profile** (`fallbackProfileId` + `allowTierFallback`), so every selection site that resolves to a profile inherits its chain automatically.
2. Triggers are **everything** — hard provider errors, timeouts, empty responses, moderation refusals. The existing content-refusal reroutes get refactored into consumers of one unified fallback engine.
3. "Similar tier" is defined by **`modelClass` quality** (`lib/llm/model-classes.ts`), the same ranking auto-configure already uses for failover.
4. **Primary-first, danger-safe:** no stickiness — every new call tries the primary again; and in a dangerous-routed context, auto-picked tier candidates must be `isDangerousCompatible`. Courier-transport profiles are never auto-selected.

## The problem

Anywhere the settings lock down a specific LLM — a character's default profile, a per-seat
override, the cheap LLM, image description, the uncensored slots — a dead or erroring
provider means the call just fails. Today, `runPrimaryStream`'s catch-all error path
(`lib/services/chat-message/primary-stream.service.ts`, case (c) around line 350) rethrows
unconditionally: auth failures, rate limits, network errors, 5xx, and model-not-found never
try an alternate. Every *existing* cross-provider fallback in the codebase is keyed on
content refusal (empty response / moderation), not on call failure.

## The contract

Every connection profile gets an ordered chain of at most three attempts:

1. **The profile itself** (the specific first option).
2. **Its configured fallback profile** (`fallbackProfileId` — the specific second option).
3. **One auto-picked same/similar-tier replacement**, only if `allowTierFallback` is on.

The tier picker gets exactly **one** candidate — one chance. If that fails too (or no
candidate qualifies), the call fails for real, and a chat call surfaces a toast saying so.

Chains do **not** recurse: when profile A falls back to profile B, B's own
`fallbackProfileId` is *not* followed. This makes cycles harmless (A→B, B→A is legal
config) and keeps the worst case at three attempts. The only config-time validation needed
is `fallbackProfileId !== id` (no self-reference) and no Courier-transport target.

No stickiness: a successful fallback applies to that call only. The next message tries the
primary again, so transient outages heal themselves.

## Phase 1 — schema, migration, repository

- **`ConnectionProfileSchema`** (`lib/schemas/profile.types.ts`): add
  `fallbackProfileId: z.string().uuid().nullable().optional()` and
  `allowTierFallback: z.boolean().default(false)`.
- **Migration** in `migrations/scripts/` (registered in `index.ts`): two `ALTER TABLE
  connection_profiles ADD COLUMN` statements. No collection loop, so no `reportProgress`,
  but the **pretty label** in `lib/startup/prettify.ts` is mandatory (steampunk voice —
  something in the spirit of teaching each connection its understudy).
- **`lib/llm/connection-profile-legacy-fields.ts`**: add both columns to the
  restore/import drift handling — that module exists precisely because newly added profile
  columns silently vanish on restore-from-older-backup otherwise. Read its header comment
  and follow it.
- **`docs/developer/DDL.md`**: document both columns.
- **Export/import:** connection profiles ride in `.qtap` exports and backups — carry both
  fields through export, import, and backup/restore, and update
  `public/schemas/qtap-export.schema.json`. (Standing rule: new data-model fields always
  join import/export.)
- Repository needs no new queries; `findById` covers chain resolution. Deleting a profile
  that others point at via `fallbackProfileId` should null those references (same pattern
  as other dangling-id cleanups) — add that to the repository delete path and to the
  migration's mental model.

## Phase 2 — the fallback engine

New module, suggested home `lib/llm/fallback/` (it is provider-layer machinery, not
chat-message-specific):

```
lib/llm/fallback/
  engine.ts        — buildFallbackChain(), classifyFallbackTrigger()
  tier-picker.ts   — pickTierCandidate()
  types.ts         — FallbackContext, FallbackAttempt, FallbackOutcome
```

### `classifyFallbackTrigger(error | outcome)`

Maps a failure to a trigger class, building on `lib/llm/errors.ts`:

| Trigger class | Source |
|---|---|
| `auth` | `APIKeyError` |
| `rate-limit` | `RateLimitError` |
| `network` | `NetworkError`, request timeouts |
| `model-missing` | `ModelNotFoundError` |
| `provider-error` | 5xx / `LLMProviderError` catch-all |
| `empty-response` | call succeeded, no text (existing `provider-failover` trigger) |
| `moderation-refusal` | `describeModerationRefusal` / `isImageModerationError` positives |

Non-triggers (never fall back): `TokenLimitError` / `ContentLimitError` (these already
have their own in-character recovery and would fail identically on any provider),
`isToolUnsupportedError` (already retried same-profile with tools stripped), and Zod
validation errors (our bug, not the provider's).

### `buildFallbackChain(primary, repos, context)`

Returns the ordered candidate list `[primary, secondary?, tierPick?]` where:

- `secondary` = `repos.connections.findById(primary.fallbackProfileId)`, dropped if
  missing, deleted, Courier-transport, or identical to primary.
- `tierPick` = `pickTierCandidate(...)`, only when `primary.allowTierFallback`.

Candidates already tried this call are skipped (loop guard, same pattern as
`resolveUncensoredImageProfileForReroute` and `attemptEmptyResponseRecovery`'s same-id
checks).

### `pickTierCandidate(failed, alreadyTried, repos, context)`

One candidate or null. Filter the user's profiles:

- exclude `alreadyTried` ids and `transport === 'courier'`;
- require a usable API key (`resolveConnectionProfileApiKey` from
  `lib/services/api-key.service.ts`) or an Ollama/local provider;
- require the context's capabilities — `context.needsVision` ⇒ `supportsImageUpload` +
  `providerCanTransportImages(provider)`; `context.needsTools` ⇒ provider tool support
  (or the caller accepts pseudo-tool mode); text chat needs nothing extra;
- **danger-safe:** `context.dangerous === true` ⇒ `isDangerousCompatible === true`;
- tier match: `getModelClass(candidate.modelClass)` quality **>=** the failed profile's
  quality (mirror `pickAutoConfigureCandidates` in
  `lib/services/*/auto-configure.service.ts` line ~145 — the one place already ranking
  profiles by modelClass for failover). A profile with no `modelClass` set counts as
  quality-unknown; treat unknown-vs-unknown as a match, unknown-vs-known as a non-match.

Rank the survivors: prefer a **different provider** than the failed one (case-normalized —
`ProviderEnum` is an open string), then highest quality, then `sortIndex`. Return the top
one only.

### `FallbackContext`

Carried by every consumer: `{ userId, purpose: 'chat' | 'cheap' | 'vision' | 'carina' |
'console' | 'help', dangerous: boolean, needsVision: boolean, needsTools: boolean,
alreadyTried: string[] }`. Attempts are recorded as `FallbackAttempt { profileId,
provider, modelName, trigger, error }` for logging and for the user-facing failure
message.

Standing rule: every path in this module fires debug logs via the built-in logging system
— chain built, candidate skipped (and why), attempt failed (trigger class), attempt
succeeded.

## Phase 3 — chat (Salon) integration

The ready-made re-entry point is **`restreamInto(state, opts)`**
(`lib/services/chat-message/provider-failover.service.ts` line ~282) — it already pushes a
fresh stream into the existing `StreamingState`, mutating `state.effectiveProfile` /
`effectiveApiKey`, emitting SSE status, preserving reasoning segments.

1. **Hard errors:** in `runPrimaryStream`'s catch (case (c), `primary-stream.service.ts`
   ~line 350), before `preservePartialOnError` + rethrow: classify the trigger; if
   fallback-eligible, walk the remaining chain via `restreamInto`, emitting a new SSE
   status `stage: 'failing-over'` with the candidate's name per attempt. Rethrow only when
   the chain is exhausted. The `StreamingState.effectiveProfile` slot is the single
   mutable seam every downstream stage already reads — the swap composes with everything
   after it.
2. **Empty response:** refactor `attemptEmptyResponseRecovery` to consume the engine. Keep
   the existing order semantics: one same-profile retry first, then — if the chat is in
   dangerous AUTO_ROUTE territory — the uncensored reroute (unchanged, it is a *content*
   response, not an availability one), then the profile's own fallback chain. The
   uncensored profile, being a connection profile itself, carries its own
   `fallbackProfileId`/`allowTierFallback`; when *it* fails on a hard error, its chain
   runs **with `dangerous: true`** so tier picks stay `isDangerousCompatible`.
3. **Pre-call dangerous reroute** (`danger-orchestrator.service.ts`) stays a pre-call
   profile swap — it is routing, not failure. But once the swap happens, the effective
   profile's chain governs any subsequent failure, which is what makes "uncensored general
   chat fallback" configurable exactly like everything else.
4. **Failure surfacing:** when the chain is exhausted on a chat call, the SSE error event
   (`encodeErrorEvent`) carries a summary of the attempts ("Claude Sonnet failed
   (rate-limit), Kimi failed (network); no tier replacement qualified"). Client side:
   `app/salon/[id]/hooks/useSSEStreaming.ts` needs a case for `stage: 'failing-over'`
   (today only `'retrying'` toasts, ~line 512) — show a warning toast naming the
   understudy; the final error already reaches `showErrorToast`. Add the new stage string
   to `app/salon/[id]/components/system-message-labels.ts`.
5. **Cleanup:** `turn-orchestrator.service.ts` lines ~20-32 declare `ChainConfig.maxRetries`
   / `retryDelayMs` that nothing reads — either wire them into the engine's per-attempt
   delay or delete them; don't leave the trap.

The other bespoke chat-shaped paths — Carina (`carina.service.ts` `resolveCarinaProfile`),
Brahma Console, Help Chat — resolve a profile and then call the provider directly. Give
each the same treatment at its call site (classify → walk chain → re-issue), reusing the
engine; they don't stream into `StreamingState` so they can't use `restreamInto`, but the
chain-building and tier-picking are identical. These can land after the Salon path.

## Phase 4 — cheap LLM integration

The cheap path speaks `CheapLLMSelection` (`lib/llm/cheap-llm.ts` line ~52), not
`ConnectionProfile` — provider + model + baseUrl + *optional* `connectionProfileId`.

- Add a converter `selectionFromProfile(profile): CheapLLMSelection` (most of it exists in
  `profileParams()` / the resolver already).
- In `executeCheapLLMTask` / `runCheapLLMTask`
  (`lib/memory/cheap-llm-tasks/core-execution.ts` ~line 388/416): on a fallback-eligible
  trigger (including the existing `CheapLLMTimeoutError`), if the selection carries a
  `connectionProfileId`, load it and walk its chain with `purpose: 'cheap'`, re-issuing the
  task with a fresh deadline per attempt (mirror what the existing uncensored fallback at
  line ~440 does). The existing empty-→-uncensored fallback stays first in order, then the
  chain.
- A selection with **no** profile id (pure-local Ollama pick, provider-cheapest synth):
  there is no profile to hang a chain on. Tier fallback for these is governed by a single
  instance-level switch on `CheapLLMSettingsSchema` —
  `allowCheapFallback: boolean` (default false) — which, when on, lets the engine pick one
  candidate among `isCheap === true` profiles (danger-safe when the task is an uncensored
  reroute). This is the one place config lives off-profile, because there is no profile.
- Background-job callers (`title-update`, `chat-danger-classification`, avatar/story
  handlers, memory processor, scene tracking, Pascal's `llm-consult`, wardrobe) get the
  behavior for free through `executeCheapLLMTask`; callers that invoke
  `getCheapLLMProvider` and stream manually (e.g. `image-generation-handler.ts` prompt
  crafting) should be audited and routed through the same execution helper where feasible
  — list them from the call-site inventory in this doc's research notes rather than
  patching each ad hoc.
- No toast for background work — the job logs the attempt trail and fails as it does
  today; only *chat calls* toast (per the human's spec).

Note the child-process constraint: cheap tasks run in the forked job child, which reads
via readonly repos. Chain resolution is reads-only (find profiles, decrypt keys via the
existing child-safe paths), so this works — but verify key decryption is available in the
child the same way the existing uncensored cheap fallback manages it.

## Phase 5 — image reading (vision) integration

`lib/chat/file-attachment-fallback.ts`:

- `getImageDescriptionProfile()` keeps its current precedence for picking the *primary*.
- The describe call (lines ~608-641) currently does primary → configured uncensored
  fallback. New order: primary → **primary's fallback chain** (`needsVision: true`, so
  candidates must pass `supportsImageUpload` + `providerCanTransportImages`) → the
  uncensored image-description profile on refusal-shaped failures (unchanged semantics,
  it's the content escape hatch) → that profile's own chain (`dangerous: true`).
- Keep `usedUncensoredFallback` metadata; add the attempt trail alongside it.
- `lib/wardrobe/image-analysis.ts` and the character wizard's `visionProfileId` path pick
  their own primaries; give their call sites the same classify→chain treatment. Their
  differing primary preferences (wardrobe prefers non-cheap) are untouched — the chain
  only activates on failure.

**Out of scope:** image *generation* (`ImageProfile`) fallback. The Lantern's moderation
reroute machinery stays as is. If wanted later, the same design maps onto `ImageProfile`
one-for-one (`fallbackProfileId`, `allowTierFallback`, a tier notion TBD since image
profiles have no `modelClass`). Note it in ROADMAP if desired.

## Phase 6 — settings UI

`components/settings/connection-profiles/ProfileModal.tsx` gains a "Fallback" section
(near the `modelClass` field, since the tier toggle depends on it):

- **Fallback profile** dropdown: the user's other profiles, excluding self and Courier
  profiles; a "None" option. Show the target's provider/model as the option label.
- **Allow similar-tier replacement** checkbox, with hint copy (Quilltap voice — an
  understudy chosen from the company when both named players are indisposed). When the
  profile has no `modelClass`, show a nudge that the tier picker works best with one set.
- If the selected fallback target is itself missing an API key, surface a soft warning,
  not a block (keys can arrive later).
- `hooks/useConnectionProfiles.ts` / the profile PUT route pass the fields through —
  standard `withActionDispatch` route already handles profile updates; just extend the
  schema.

Cheap-LLM UI: one checkbox ("allow a similar-tier stand-in when the cheap route fails")
in `components/settings/chat-settings/CheapLLMSettings.tsx` bound to
`allowCheapFallback`.

## Phase 7 — docs, help, tests

- **Help** (mandatory for user-visible changes): update the connection-profiles help doc
  (or add `help/provider-fallback.md`) with `url` frontmatter
  (`/settings?tab=providers`) and a matching "In-Chat Navigation" `help_navigate` call;
  touch the cheap-LLM and Concierge help pages where behavior changed.
- **CHANGELOG** (plain voice), **DDL.md**, **API.md** if the profile payload docs list
  fields, and the docs listed in `update-documentation`.
- **Tests:**
  - Unit: `classifyFallbackTrigger` over the error taxonomy; `pickTierCandidate` filters
    (courier excluded, danger-safe, vision capability, quality >=, provider diversity
    preference, unknown-modelClass rules); `buildFallbackChain` loop guards
    (self-reference, A→B→A non-recursion, deleted target).
  - Service: `runPrimaryStream` hard-error → chain walk → SSE `failing-over` → exhausted
    chain rethrows with attempt trail; empty-response ordering (retry, uncensored, chain);
    cheap-task fallback with fresh deadlines; vision chain with capability filtering.
  - Regression: Concierge pre-call reroute unchanged; token/content-limit recovery still
    bypasses the chain; `restreamInto` reasoning preservation survives multiple swaps.
  - Follow the Jest mock conventions (global `jest`, subject-imports-first, bare
    factories).

## Risks and traps (read before implementing)

- **Two currencies.** Chat carries `ConnectionProfile` + decrypted key; background carries
  `CheapLLMSelection`. The converter in Phase 4 is load-bearing — don't let the two paths
  drift into separate fallback logic.
- **`connection-profile-legacy-fields.ts`** — skipping it means the new columns evaporate
  on restore-from-older-backup. It's the documented trap for exactly this kind of change.
- **Refusal-path unification is the risky refactor.** Land the engine + hard-error path
  first (pure addition), then fold `provider-failover.service.ts` and
  `file-attachment-fallback.ts` into it in their own commits with the regression tests
  above. The Concierge's *pre-call* classification reroute is not a failure path and
  should not move.
- **Rate limits:** `RateLimitError.retryAfter` exists and is unused. A fallback on 429 is
  correct (different provider = different bucket), but don't add same-provider
  wait-and-retry in this feature — note it as future work.
- **SSE contract:** new `stage: 'failing-over'` needs the client case or it silently
  becomes an unexplained status line; the toast-on-`retrying` precedent shows where.
- **Case-normalize provider comparisons** (`ProviderEnum` is an open string).
- **Realtime:** none of this needs a new polling site; failure surfacing rides the
  existing SSE stream.


## As built

Implemented 2026-08-29. The design above was followed; these are the points
where the code differs from it or where it needed a decision the spec left open.

### Deviations

- **Hard-error failover runs only before the first content chunk.** Phase 3
  did not say what to do about a stream that dies *after* prose has reached the
  user. `restreamInto` appends to `state.fullResponse`, and the client
  accumulates content chunks with no reset in the SSE protocol — so
  substituting a response mid-stream would show the user the truncated fragment
  with the understudy's answer glued onto it. The chain therefore checks
  `state.hasStartedStreaming` and declines, leaving `preservePartialOnError` to
  save the partial with its OOC marker exactly as before. Nearly every failure
  the chain exists for (auth, rate limit, model-missing, connection refused)
  arrives before a single token does. Making a mid-stream swap work needs a
  client-visible reset event; that is the follow-up, not a silent change to
  what the user sees.

- **Tool-capability filtering uses the profile's `allowToolUse`, not provider
  tool support.** The spec allowed either. A model with no native function
  calling is served by the pseudo-tool formats, which is what
  `pseudoToolMode: 'auto'` resolves to — so provider support is not a real
  constraint, and the profile's own master override is the only meaningful gate.

- **`pickTierCandidate` checks credentials statically**, via
  `acceptsApiKey`/`requiresApiKey` plus the presence of `apiKeyId`, rather than
  calling `resolveConnectionProfileApiKey` per candidate as Phase 2 suggested.
  The picker runs on a failure path — sometimes in the forked job child — on a
  call that is already late; a key-table round trip per candidate is latency
  spent to learn something the column already implies. The decrypt happens once,
  on the candidate actually chosen.

- **`system-message-labels.ts` needed no change.** Phase 3 item 4 asked for the
  new stage string to be added there, but that file holds `systemKind` display
  labels, not SSE stages. `stage` is typed as a bare `string` and its `message`
  renders directly; the only stage-specific client logic is the spinner
  (`'streaming'`) and the toast, which now fires for `'failing-over'` alongside
  `'retrying'`.

- **`ChainConfig.maxRetries` / `retryDelayMs` were deleted, not wired.** The
  chain has no per-attempt delay: a different provider is a different bucket,
  and waiting before trying it buys nothing. Their test assertion went with them.

- **Both id-rewriting paths needed remapping the spec did not call out.**
  `fallbackProfileId` points at another row in the same table, which makes it
  the first profile column that has to follow an id rewrite. A `.qtap` bundle
  under the `duplicate` conflict strategy assigns fresh ids, so a carried
  `fallbackProfileId` would point at the user's *original* profile rather than
  the imported copy — or at nothing; remapping happens in the reconcile pass
  (`lib/import/quilltap-import/reconcile.ts`) rather than at insert time,
  because a profile may name an understudy that appears later in the bundle.
  New-account backup restore has its own remapper
  (`lib/backup/restore/uuid-remap.ts`) which rewrites profile `id` but was not
  touching `fallbackProfileId`; adding it to that `remapFields` list was the
  fix, and it is safe in any order because `UuidRemapper.remap()` is lazy and
  consistent. Caught on the pre-commit data-model review, not during
  implementation — the spec's "carry both fields through export, import, and
  backup/restore" reads as a field-fidelity instruction, and fidelity was never
  the problem; referential integrity was.

- **`connection-profile-legacy-fields.ts` carries the two columns, but not for
  the reason the other two are there.** Both new defaults (NULL, 0) *are* the
  neutral answer, so there is no bug-103-shaped hazard. What the module does add
  is a self-reference check: `fallbackProfileId` is its first column holding a
  *reference*, and a hand-edited bundle can name the profile itself.

- **The named understudy is filtered on vision, which the spec did not ask
  for.** Phase 2 applies capability filtering to `pickTierCandidate` only —
  the configured understudy is described as dropped just for being missing,
  deleted, Courier, or identical to the primary. But a chain reuses the
  `formattedMessages` built against the primary, and on an image-carrying turn
  the raw bytes are already embedded in that array; a stand-in without
  `supportsImageUpload` + `providerCanTransportImages` is not a risk but a
  guaranteed 400. This is bug 106 exactly — the Concierge's uncensored reroute
  hands a vision-built array to a text-only substitute — and shipping the chain
  without the guard would have multiplied that defect's blast radius from one
  reroute to every profile in the instance. Skipping is strictly better than
  spending the attempt on a call that cannot succeed.

  Vision is the *only* thing a user-named understudy is filtered on.
  Danger-compatibility deliberately is not: an auto-picked stand-in must be
  cleared for the content, but a profile the user named themselves is their
  call. The distinction is incompatibility versus policy.

  The better answer — re-running `processFileAttachmentFallback` against the
  profile actually being called, so a text-only understudy takes the turn with
  a description instead of being skipped — is bug 106's own fix and belongs
  with it, not here.

### Not done

- **Carina, Brahma Console and Help Chat** still resolve a profile and call the
  provider directly, with no chain. The spec explicitly allowed these to land
  after the Salon path. The engine is ready for them — each needs a
  classify→chain→re-issue at its own call site, in the shape
  `attemptCheapFallbackChain` uses (they do not stream into a `StreamingState`,
  so `restreamInto` is not available to them).

- **`getCheapLLMProvider` callers that stream manually** — notably
  `image-generation-handler.ts`'s prompt crafting — were not audited or rerouted
  through `executeCheapLLMTask`. Everything going through `executeCheapLLMTask`
  gets the behaviour for free; these do not.

- **Image *generation* (`ImageProfile`) fallback** remains out of scope, as
  specified.

- **Same-provider wait-and-retry on 429.** `RateLimitError.retryAfter` is still
  unused. Failing over to a different provider on a rate limit is correct and is
  what happens now; waiting out the limit on the same one is separate future
  work.

### Verified against V4test (2026-08-29)

Live, against real providers, with a purpose-built profile pointed at a dead
endpoint (`http://127.0.0.1:9/v1`):

- Migration ran clean on an existing instance; both columns present with the
  expected defaults.
- Editor round-trip: understudy and tier checkbox save and reload; the dropdown
  excludes the profile being edited.
- API guards: self-reference, unknown target, and non-boolean
  `allowTierFallback` each rejected with 400.
- **Configured understudy** — dead endpoint failed (`provider-error`, "Connection
  error."), `OpenAI - gpt-5` answered, and the saved message was attributed to
  `OPENAI`/`gpt-5`, confirming the `effectiveProfile` swap reaches finalization.
- **Chain exhausted** — two dead endpoints in sequence produced the SSE error
  `"Connection error. (Dead Endpoint (failover test) failed (provider-error),
  Dead Endpoint 2 (failover test) failed (provider-error); no tier replacement
  qualified)"`.
- **Tier pick** — with no understudy and `allowTierFallback` on, the picker
  drafted `gpt-5` over a same-provider sibling, logged its reasoning, and the
  client received `stage: 'failing-over'` naming the stand-in.
- **Delete cleanup** — deleting a profile nulled `fallbackProfileId` on the
  profile that named it.
