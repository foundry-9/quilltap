# Bugs — defects surfaced by the v5 port

**Last Updated**: 2026-09-05
**Codebase**: Quilltap v4.9.0-dev
**Provenance**: the quilltap-v5 native port's differential harness, its
dogfood walks against a copy of real data, and — from Bug 62 — v4's own
feature-spec work and browser verification
**Status**: Bugs **1–123** are **fixed in v4**; nothing is open. **123** was
filed and fixed on 2026-09-05, from a live Friday chat that fell quiet after a
provider failure: the chain-error safety stop paused it, the Salon's pause sync
keyed on a *change* in the fetched flag and so never learned of a second pause
after a Resume, the chain guard returned on a paused chat with no event and no
log line, and the Skip button was keyed on whose turn the client's rotation
thought it was. Reconcile-on-every-fetch, an announced `paused` chain-complete,
and a Skip button for whatever seat the composer speaks as. **122** was
filed and fixed on 2026-09-05, from a live Friday scene in which a man answered
a question aimed at a woman, as that woman — fluently, with her history, in her
voice. A character's memory store is keyed on `characterId` alone: it holds
what they remember about themselves and what they remember about everyone else,
separated only by `aboutCharacterId`. Four formatters render memories into
context and exactly one of them said whose life a line described; the other
three printed the bare summary, and `buildCommonplaceLLMContext` headed all
three with *"You remember the following entries that bear on this moment"*. So
`struggles to become offered mother` and `reassured Marie about her wish` — both
Marion's — arrived in Kumar's context as autobiography, and he wrote the reply
he had been given the life for. The same memory `11de858e` appeared **twice in
one whisper**: correctly attributed under *"You also recall about the others
present"*, and confessed as his own two sections above. Its lesson is that a
**pool** and a **voice** are two different questions — selecting memories by
owner is right, and rendering them as the owner's own is not the same decision.
The repair is one required prefix function at every self-facing call site;
required rather than optional, because omission is exactly how the defect
arrived. Nothing about it errors, warns or logs — the turn succeeds, reads well,
and is billed — so the only detector was a human who knew the cast. **121** was
filed and fixed on 2026-09-04, from a live Friday scene in which one character
quoted an attached transcript and the next said she could not read it. She was
right, and she was the only participant who noticed — a third opened *"I let the
transcript settle behind my eyes a moment"* and then searched twice for phrases
from it, found nothing, and carried on. The file was expanded into prompt text
at request-assembly time and stored nowhere, so it reached the first character
to answer and no reader afterward: not the other five in the scene, not any
later turn, not the summarizer, while the attachment chip sat in the UI saying
otherwise. Its lesson is about **where an expansion lives**: the row kept a
pointer and the model had been given prose, and nothing turned the pointer back
into prose. The same walk that carries Lantern images forward is filtered to
`role: ASSISTANT`, so a user-uploaded *image* was one-shot for the identical
reason — bug 95 fixed which message the bytes ride on and never asked how long
they ride, because a single-character chat has exactly one rider. The repair is
a read-side derivation over the same fallback pass the upload path uses, so
text, described images and natively-carried bytes are all covered by one
mechanism, and the "stop at the character's own prior turn" rule that bounds the
Lantern walk doubles as its budget: once apiece, never once a turn. **120** was
filed and fixed on 2026-09-04 by the v4.9 release checklist's CLI pass (item
12), which audits the flags the CLI accepts against the flags it documents.
It is a small bug with a long shadow: a documented `--json` that had never
worked, offered by two of the three completion templates, unmentioned by the
CLI's own `--help`, and invisible to the coverage suite that exists precisely
to stop this — because that suite checks help-text → completions and this is a
failure in the other direction. **119** was
filed and fixed on 2026-09-02, from one screenshot of the Refine-from-Memories
confirmation screen carrying an error banner that read, in its entirety,
`q.filter is not a function`. The optimizer fans a character out into one LLM
pass per concern — general fields, each scenario, each system prompt, physical
description, wardrobe, aliases, proposed prompts — and each pass asks for a JSON
array. A model that answers with `{"suggestions": [...]}` instead produces text
`JSON.parse` accepts, so the parse guard never fires, and
`parseLLMJson<OptimizerSuggestion[]>` is a *cast*, not a check: the object walked
into `.filter` and the TypeError took the whole run with it, four sub-steps and
three minutes of paid model time from the finish line. The lesson is the same
one 118 makes about declarations: **`JSON.parse` succeeding says nothing about
the shape**, and every other array-shaped parse site in the codebase re-checks
with `Array.isArray` inside the function it hands off to — the optimizer was the
one that filtered inline. A fan-out of independent passes now contains a throw
to the pass that caused it. **116–118**
were filed and fixed on 2026-09-02, all three out of a single uploaded screenshot — a gothic warship
with its name across the hull — that Quilltap recorded as "a small, fluffy
kitten," in 3175 characters, with a paragraph on the bokeh and the observation
that no text was present. **116** is the defect proper, and its lesson is that
**bug 91's gate answers the wrong question**: it asks whether we *can* send an
image and never whether one *arrived*. Everything on our side was correct — the
plugin serialised the `image_url` part, the mime type was supported, both halves
of `profileCanReceiveAttachment` passed honestly — and NanoGPT's route for the
configured describer discarded the bytes upstream, where we have no control but
perfect visibility: `promptTokens: 38`, the instruction and nothing else. Two
disproofs sat unread on the response object while the only check performed was a
grep for refusal words, which by construction catches the model that *admits* it
cannot see and never the one that answers confidently. The result was then
persisted to `files.description`, where it short-circuits every later reader
forever — so the `describe_image` call that surfaced it, 65 seconds after upload,
was already too late. **117** and **118** were found while diagnosing it and are
unrelated in cause: 117 is a chat upload recording the hash of its *pre-transcode*
bytes, so half of Friday's uploaded images cannot be joined to the document store
that holds them (the sibling path in `images-v2` orders the same two operations
correctly, and all 2541 generated images match); 118 is the NanoGPT manifest
still declaring, a year and eleven versions on, the text-only behaviour bug 91
removed — the one declaration of three that no test gates, left ungated by a
decision that was correct when it was made.

All three were fixed the same day they were filed. **116** now verifies the
image arrived before the answer is believed, reading both proofs that were
already on the response object — the plugin's attachment ledger and the prompt
token count, against a ceiling derived from the instruction itself — and
failing the attempt into the existing fallback chain rather than returning the
text. **117** stopped choosing between its two defensible answers and removed
the conflict instead: the chat upload path now runs the storage bridge's own
transcode *before* anything is hashed, exactly as `images-v2` always did, so
one hash serves both the dedup that made the input hash attractive and the join
that made it wrong; `realign-file-entry-sha256-v1` repairs the rows already
written, and the same drift was corrected in the import and restore writers.
**118** corrected the manifest and put the third declaration under the test
that already held the other two — the build still wins a disagreement, but the
disagreement now fails rather than waits. **115** was filed
and fixed on 2026-09-02, from a four-character room whose turns had walked from
a ~6s first reply that morning to 7m16s by evening, with no error anywhere and
every job reporting a clean finish. The instance's cheap-LLM route had moved to
a gateway that accepts a request and then never answers, and one cheap call is
awaited *inside* the turn: the dynamic-head distillation in `context-manager`,
which named no latency tier and so took the background 90s **plus** the timeout
retry a background pass is entitled to — three minutes of empty composer per
responding character, in a room that chains through four. Bug 107 built
`CheapLLMLatencyClass` for exactly this distinction and applied it to the two
inline calls it had in front of it, one branch away in the same file; this third
one was missed because its task type in 107's histogram is `MEMORY_EXTRACTION`,
shared with the per-turn passes that genuinely are background — **a task-type
audit cannot see the difference between two callers of one function**, which is
the difference the tier exists to express. It then stayed invisible because the
failure has no failure: the branch falls back to the raw recent-window query it
already holds, recall gets slightly worse, and the turn arrives. The fix makes
the tier a parameter and has the blocked caller name it; the untested arithmetic
underneath 107 gets four cases, and a call-site test asserts the argument leaves
`context-manager` at all — which is the half 107 lacked and the reason this
slipped. **114** was filed
and fixed on 2026-09-02, from a `folders` table holding 607 rows for 24 real
folders. Only the two machine-written paths repeated — `/character-avatars/` and
`/story-backgrounds/` — and the count tracked the number of images generated;
every folder a human made had exactly one row. The cause is a read that failed
soft: `FolderSchema.parentFolderId` was `.nullable()` without `.optional()`
while the SQLite hydrator turns a NULL column into `undefined`, so every
root-level folder threw on validation, and `findByPath` returned its `safeQuery`
fallback — `null`, the same answer as "no such folder." Six call sites each
hand-rolled `findByPath` → `create` in front of it, so every generated image
appended another row for a folder that had been there since February. The
trigger was fixed in April (c180246b1, one line, correct, exact commit message)
from the other end, without anyone asking what a read failing for two months had
been *doing*; 600 rows predate that commit and 7 follow it, none of them
duplicates. The lesson is that **a read whose failure is indistinguishable from
its empty result is a write amplifier** wherever the caller answers "not there"
by creating — silent at the read, valid at each write, visible only in a row
count nobody has reason to look at. The fix is one `ensureByPath` chokepoint
with a unique `(userId, COALESCE(projectId,''), path)` index behind it, so no
call site can duplicate and a lost race reconciles to the winner.
**113** was filed
and fixed on 2026-09-01, from a file that would not move anywhere but a
project's root: the **Move to Project** folder dropdown offered `/ (Root)` and
nothing else, for every destination, while the folders were plainly there in the
database. The cause is a derived list mirrored into component state behind an
"only if empty" guard — and the instructive part is *which* render satisfied
that guard. The derivation seeds Root unconditionally, before consulting any
data, so the very first render, with both queries still in flight, produces a
one-entry list that passes `length > 0`; the mirror is filled with the loading
state and sealed against every update that follows. The correct list was sitting
one line above the one being rendered the entire time. Two things kept it alive:
the failure mode is a *plausible* dropdown — Root is genuinely always a valid
destination, so the control reads as a project with no folders rather than a
broken control — and the guard looks like it runs against settled data, when in
fact it is an IIFE in render and the loading pass nobody pictures is the one
that wins. The lesson is about **mirroring what you can derive**: the fix
deletes the mirror rather than fixing the guard, and a change of destination
then re-derives by construction instead of by remembering to invalidate.
**112** was filed
and fixed on 2026-08-30: a chat's "last updated" time was the last time
*anything* about the row changed, so a story background finishing its render,
a summary folded, or any Staff announcement floated a months-dead conversation
to the top of every list. The instructive part is that the correct predicate
was **already in production** — `getLastPlayedMessageAt`, written for the
stale-chat asset sweep, whose doc comment says outright that a Staff whisper is
not activity. Nothing ever connected that judgement to the timestamp shown to
the reader, so one codebase carried three different answers to "what counts as
a message" and the user-facing one was the wrong one. The lesson is about
**a judgement made once and not shared**: the fix is a single chokepoint
(`lib/chat/chat-activity.ts`) that the write path, the staleness sweep, and
every list now ask, rather than three places each deciding for themselves.
**110** and
**111** were filed and fixed on 2026-08-30, out of one sitting trying to point a
NanoGPT image profile at a LoRA, and they are the two halves of the same
sitting: the bug that wasted it and the missing line that would have ended it.
110 is a configured `lora_preset` dropped in silence because no adapter
happened to sit beside it — and the giveaway is that the generation
**succeeded**, was charged for, and returned a perfectly good image of the
wrong thing. 111 is why that took as long as it did: the only record of what
was actually posted is logged at `debug`, and no packaged instance keeps
`debug`, so three consecutive provider 400s were indistinguishable in the logs
and had to be told apart by reading the profile row out of SQLCipher. Read
together they are one lesson about **where a fact is written down**: 110 put a
standalone option behind a guard that asks about its neighbour, 111 put the
decisive diagnostic behind a level chosen for the case that never needs it.
Both fixes move the fact to where the question is actually asked — the scoped
key is applied on its own terms, and the composed request is logged on the path
that fails. Worth keeping from the diagnosis: an applied adapter cost **13.3 s**
against **7.7 s** for the same prompt with the adapter silently dropped, and
that duration gap was the only externally visible difference between them.
**108** and
**109** were filed and fixed on 2026-08-29, from one turn in the Salon in which
a character could not edit a document she had just read, and they are a matched
pair: both are a tool **reporting the wrong fault**, and in the same sentence.
108 is a call that arrived without its `find` argument and was answered with
*"Text not found in file… use the exact text from your most recent read"* — the
one remedy that cannot work, since the fault was in the call rather than the
content; the model re-read and repeated the identical malformed call. 109 is the
same sentence sent to a model whose find text was *right*, and differed from the
file only in spelling a quote `'` where the file said `’`. The shared lesson is
about error text, not about matching: **an error that names the wrong cause is
worse than a vague one, because a model will act on it.** Both fixes therefore
change what the tool says as much as what it does — 108 names the missing
argument and refuses before opening the file, 109 folds typographic variants on
a total miss and *tells* the model that is what happened. 109 also cleared the
natural first suspicion, which is worth recording because it was wrong:
Quilltap curls nothing outside the two render pipelines, and the curly
apostrophe in the file had been written there by a model, faithfully stored.
**106** and **107** were filed and fixed on 2026-08-29, both from one sitting in the Salon
and both about a remedy that could not run — 106's uncensored reroute was handed
a payload its substitute model could not accept, and 107's cheap tasks were cut
off by budgets set inside their own healthy distribution. The pair is worth
reading together, because the same mistake made them: **an answer computed for
one set of conditions was reused after those conditions changed.** 106 kept a
message array shaped for a vision model and handed it to a text-only one; 107
kept ceilings chosen against one distribution and left them there while the
distribution moved underneath — and then, because the ceilings were inside the
data, could not see that they were wrong, since the maxima the logs reported
*were* the budget. Both fixes therefore do the same structural thing: re-ask the
question at the moment of use (106's `adaptMessagesForProfile`) or set the
number from the measured curve rather than a round figure (107's budgets), and
in both cases make the failure say what kind of failure it was, so the next
round is measurable rather than archaeological. 107 also collapsed three
independent spellings of "can this profile receive this attachment?" into one
predicate — the same drift that produced bugs 91, 97 and 104. Bug 97 (filed and fixed 2026-08-23) is the catalogue's
clearest case of a fix promoting stale metadata into a defect: the OpenRouter
plugin declared `supportsAttachments: false` — honestly, before it could send
images — and bug 45 taught the provider to serialise `image_url` parts without
touching the declaration. Bug 91 then made that declaration load-bearing, and
the two halves of the same plugin began contradicting each other. Which half
won depended on runtime state, which is the part worth remembering: in
production the registry is up and the stale `false` won, so every OpenRouter
vision profile quietly degraded to the describe-fallback; in jest the registry
is down, the static mirror won, and the suite was green over behaviour
production never exhibited. A test environment reading the opposite branch from
production is not a gap in coverage, it is coverage that argues for the wrong
answer. The declaration now **imports** its MIME list from the code that does
the sending, and the new test reads the predicate with the registry initialised
and holds every bundled plugin's built declaration against the static mirror.
Bug 96 (filed and fixed 2026-08-23) is the smallest cause
in the catalogue with the widest blast radius: a cheap model answered
`needsNewTitle: true` and put the title under `suggestTitle`, two letters short
of the key being read, and the `undefined` that came back was coerced to `null`
and folded into the same branch as a genuine decline. The chat kept its generic
title, the checkpoint cursor advanced so the retry moved from interchange 7 to
10, and — the part nobody would predict from the cause — **the story-background
subsystem went dark for that chat entirely**, because
`queueStoryBackgroundIfEnabled` is called only from the rename-succeeded branch
and takes the new title as its scene context. Nothing failed: the job reported
COMPLETED, the LLM log held a well-formed verdict, the spend appeared in the
system events, and the cursor advanced exactly as a legitimate *no* would. It is
also intermittent — the same model titled three other chats correctly that
afternoon — so the feature looks like it works and never says when it didn't.
The parser is now shared by both title tasks, tolerates near-miss keys with the
canonical one winning, and **warns whenever it had to reach or came up empty**;
the residual coupling (a chat whose title is already good still gets no
background) is documented in the bug rather than silently fixed. Bugs 91–95 (filed and fixed 2026-08-23) are one session's
worth of a single subject — an image a user shared and no character could see —
and they are worth reading together, because four of the five are failures of
*voice* rather than of logic. **91** is the load-bearing one: one question was
asked where there were two. A profile's `supportsImageUpload` tick is a
truthful claim about the **model**, and four plugins (NanoGPT, DeepSeek,
OpenAI-Compatible, Ollama) strip every attachment before the wire regardless.
Either half alone is survivable — the first sends real bytes to a plugin that
forwards them, the second triggers the describe-fallback — but together they
cancel exactly: the fallback is suppressed *because* the model reads images,
and the bytes are dropped *because* the plugin cannot send them. The model
receives nothing and writes a confident paragraph about a picture it never saw,
which is the worst available failure mode because it looks like success. Both
authorities that knew better (NanoGPT's own manifest, and
`PROVIDER_ATTACHMENT_CAPABILITIES`, which had no entry for the provider at all)
were outside the code path. **94** is why it lasted: the plugin reported the
drop correctly in `attachmentResults.failed`, that object was threaded through
nine files onto the SSE `done` event, and no component ever read it — the
second field-with-no-reader in ten bugs, after 84. **93** is the same deafness
pointed at the provider: `glm-5v-turbo` said `finish_reason: sensitive` and the
Salon answered *this is a known issue, please try resending*, advice that cannot
work, for a cause the provider had stated outright. **95** is a good fix aging
badly — `normalizeWhisperRoles` re-roles Staff whispers to `user` for sound
reasons (bug 85), after which "the last message, if role is user" stopped
meaning the human's turn, so on any regenerate the image rode on a
connection-profile-change bubble while the Librarian's announcement insisted
the bytes were with the user's message. And **92** is the one that had been
visible for months without being named: a character's entire image vocabulary
was three *filing* verbs and no *looking* verb, so models reached for
`attach_image` to see a picture and were told to file it first — while a
3,427-character description of that very image, written by auto-describe two
minutes earlier, sat on the FileEntry with no tool able to reach it. `attach_image`
was kept and re-scoped rather than replaced; the gap was never that verb, it was
the missing one beside it. Bug 87 (filed and fixed 2026-08-22) was a NanoGPT turn
rendering its whole reply a second time inside a thinking fold anchored at the
end of the message: on some routed paths NanoGPT's gateway re-emits the
aggregated answer down the reasoning channel after the content stream ends,
and plugin 1.0.1's new — and correct — `delta.reasoning` read faithfully
recorded the echo as thinking. Token accounting proved it mechanical (746
completion tokens for a 2135-char reply, enough for it once, nowhere near
twice), and it is intermittent on NanoGPT's side — identical requests minutes
apart streamed clean. The plugin now holds post-prose reasoning while it is
still a verbatim prefix of the streamed prose: divergence commits it in full,
mirroring at stream end discards it. Bug 86 (filed and fixed 2026-08-21, a split-off from 85) was
the DeepSeek plugin deciding whether it was thinking by inspecting the request
body it was about to send, which answers "what did we ask for?" when the question
is "what will the model do?" — a V4 model with no `thinking` key reasons anyway,
so the params thinking mode ignores went out with it. Nothing errored; the plugin
README and the profile editor's help text carried the same misapprehension. The
predicate now asks the profile first and the model's `thinksByDefault` second,
the same order the host's evaluator uses. Bug 85 (filed and fixed 2026-08-21) was a
DeepSeek thinking model that greeted you and then 400ed on every later turn, with
an error text pointing squarely away from its cause: the message names
`reasoning_content` and history, but the culprit was the trailing assistant
`[Name]` prefill the multi-character anchor appends. DeepSeek's thinking mode
reads that as continuing an assistant turn and demands the reasoning that
produced it, which a synthetic prefill has none of. Laid beside the two
hostilities `lib/llm/multi-character-prefill.ts` already documented, it made a
point the individual entries did not: two of the three — Ollama's never-opened
reasoning block (bug 68) and this one — are *thinking* failures wearing a
provider's name, and only Anthropic's assistant-tail rejection is genuinely about
the provider. Hostility is now scoped to thinking-capable *models*: `ModelInfo`
carries `supportsThinking`/`thinksByDefault`, a provider plugin declares a
serialisable `thinkingTurnRule` naming its own option key, one pure evaluator
answers for host and profile editor alike, and a migration clears the stored `1`
on the rows the old blanket default wrote. A non-thinking DeepSeek or Ollama
profile keeps the prefill — bug 68's objection preserved rather than re-incurred.
Bug 84 (filed and fixed 2026-08-21) is a field with no reader: the SSE
emitter hoists a failing tool's human-readable sentence to `error`, a sibling of
`result`, *because `result` is null on failure* — and the Salon looked for it one
level down at `result?.error`, so a `generate_image` refusal that named its own
remedy displayed as `Unknown error`. One pure resolver now prefers the sibling,
keeps the nested read as a fallback, and strips the executor's `Error: ` wrapper
so the toast doesn't double it. Bug 83 (filed and fixed 2026-08-20) is the intermittent jest worker
SIGSEGV, misattributed for months to the native SQLCipher binding and finally
traced by a macOS crash report to an upstream V8 GC race
([nodejs/node#62393](https://github.com/nodejs/node/issues/62393)); the suite
now runs with Sparkplug disabled at two chokepoints, and the v5 side owes
nothing — Rust doesn't carry V8. Bugs 81 and 82 (filed and fixed 2026-08-19) both come of a request being
shaped by one answer where two were needed. In **81** the answer is a boolean:
`requiresApiKey` was asked both "must this provider have a key?" and "may it?",
and for OpenAI-Compatible — the one provider spanning an unauthenticated
llama.cpp and a hosted endpoint behind a bearer token — those answers differ, so
`false` was the only workable value and `false` removed the provider from the
Add-New-API-Key list and the profile form's key field alike. The repair is an
optional `acceptsApiKey` capability that means "same as `requiresApiKey`" when
omitted, read through one pure predicate on both sides of the wire; and the fix
had to reach further than the filing saw, because four server paths gated the
key *lookup* on the same flag and would have dropped an attached key even with
both UI gates open. In **82** the answer is a request shape: the context builder
emits up to three leading `system` blocks so a cache breakpoint on the first
survives churn in the others, which every hosted provider accepts and which the
Qwen family's chat template refuses outright — the greeting worked, every turn
after it died with a 500. The leading run is now folded at request-build time
for the two local builders only, behind a per-provider flag that defaults to
"leave it alone", so no hosted provider's bytes or cache breakpoints moved.
Bug 80 (filed and fixed 2026-08-18) is the workspace's arbitrated
backdrop meeting a view that was never converted to it: the project detail
still set `--story-background-url` on a layer that `.qt-workspace` hides, so
the "Latest chat background" setting painted nothing while the Prospero
subsystem image sat in the tab's registry slot. Bugs 78 and 79 (filed
2026-08-18, fixed the same day) are the same
sentence about two different columns: a value read back out of a loosely-typed
store was allowed to mean something it did not. In **78** `equippedOutfit` is
unconstrained JSON and the hair slot shipped on a deliberate no-migration
design — every slot key is `.default([])`, so a four-key legacy row is
*supposed* to read as `hair: []`. That holds wherever the value passes through
the schema, and `getEquippedOutfit` was the one place it did not: a raw cast,
after which the resolver indexed `slots['hair']`, handed `undefined` to
`expandComposites` and killed the avatar job on every chat older than the
feature — which is to say every real instance, since only fixtures are written
after it. The repair is a `normalizeEquippedSlots` chokepoint on the way out of
the column, which also heals the two sites that were degrading soft and quietly
dropping the character's clothes from the model's view; the resolver keeps its
`?? []` regardless, because it is exported and several callers hand it a bag
that never went near the repository. In **79** the value is a *fallback*:
`safeQuery`'s 4-arg mode answers a thrown read with `null`, and the import's
reconcile consumes that as "no such row" before committing a write — so a
destination that fails reads imports as an empty one, partially and
duplicated, and reports success. Editing the 23 nested read sites would have
meant re-deciding one question per site in files whose other callers still want
the degraded answer, so the fix carries the missing bit instead — *who is
asking* — as a `withStrictRepositoryFailures` scope around both import entry
points and a single `&& !strict` in `safeQuery`. The half the filing did not
anticipate: five importers had no `warnings` array at all and only logged, so
strictness alone would have traded a silent wrong branch for a silent skip;
they now name what they dropped, as does the preserveIds preflight, whose
refusal aborts the whole import and had been returning `success: false` with
nothing in it. Bug 76 (filed and fixed 2026-08-17) was Bug 73's shape one field over,
and the fix that closed 73 had gone straight past it: an api key chosen for one
provider stayed on the form after the provider changed, invisible on a keyless
provider and shown as blank on a different hosted one, while all four outbound
sites sent it on truthiness. The dialog said no key was selected while the wire
carried one, and the save was refused — correctly, server-side — with a
sentence naming a field the dialog does not show. The fix is the twin
chokepoint, `outboundApiKeyId`, answering the one question the truthiness test
never asked: *could the select show this id right now?* It refuses on both
counts the select can — a provider that renders no such control, and an id
outside the options it would list — which is the decision the base-URL fix
never had to make, and the half a user actually notices. Both of 73's
refinements carry across, plus a third of the same family: an api-key list that
has not loaded is no more evidence than an unloaded provider list, so an empty
one skips the test rather than stripping a working profile. Bug 74 (found 2026-08-16, fixed
2026-08-17) is the first entry here found by **v4 verifying its own fix**: two
404s sitting in the network log while the profile modal was open for bugs 72
and 73. Tagging a connection profile had never worked, three independent layers
deep — `TagEditor`'s `profile` branch called `/api/v1/profiles/<id>`, a route
that has never existed; behind that, the connection-profile GET had no
`get-tags` action and answered an unknown one with the whole profile body, so
the corrected path would still have read `data.tags` as `undefined` and shown
nothing; and behind *that*, `ProfileCard` read `tag.name` off
`enrichWithTags`'s `{tagId, tag}` envelope, so a tagged profile drew an empty
pill. The last two are one confusion twice — **two tag shapes with no owner** —
and are now settled by `resolveEditorTags`, a flattening of `enrichWithTags`
that both `get-tags` routes read, plus an `EnrichedTag` type that says what the
collection endpoint actually sends. The GET also refuses unknown actions now
rather than serving the profile, which is the leniency that hid layer 2 in the
first place. Bugs 72 and 73 (filed and fixed
2026-08-16) are both the profile editor failing to distinguish *shown* from
*sent*, and both were surfaced by the same dogfood walk over the bug 71
schemas — the panel's first contact with real hands. In **72** a numeric option
read its value straight off the parameter bag, so clearing the box deleted the
key, `fieldValue` fell back to `field.default`, and the default repainted over
the empty box with the caret behind it: clear `300`, type `5`, store `3005`.
`NumberField` now owns a draft string, with a `syncedFrom` companion telling its
own echo from an outside change — the naive re-sync-on-prop-change spelling
reintroduces the bug for any field that had a stored value before the clear.
The draft alone leaves the second consequence live, because a fresh mount still
seeds from `fieldValue`'s fold-in of the default; so `fieldValue` now returns
`undefined` for number fields and the default renders as the `placeholder`,
which is what finally makes *"leave blank for the default"* a state the user
can see themselves reaching, on first open as well as after a clear. In **73** the Base URL box is gated
on `requiresBaseUrl`, but all four outbound sites sent the value on truthiness
— so a passing glance at Ollama left `http://localhost:11434` clinging
invisibly to a profile that then could not connect, with no gesture available to
clear it. A new `outboundBaseUrl` chokepoint returns `''` for any provider the
plugin list says takes none — and, deliberately, *not* for a provider the list
does not know, since an unloaded or failed provider fetch must not read as
"clear this profile's URL". The save body drops its `if (baseUrl)` guard and
sends the empty string, because omitting the key leaves the PUT's
`baseUrl !== undefined` gate untripped and every already-poisoned row broken
forever. `handleProviderChange` is deliberately untouched — the value stays in
form state, inert rather than destructive, and returns if the user switches
back. Bug 71
(filed and fixed 2026-08-15 while benchmarking `Qwen3.8-27B` on an M4 Pro) was
the general case of the problem
[Bug 68](bugs/fixed/bug-68-ollama-prefill-kills-thinking.md) solved one instance
of: the two local-model providers had no route for a provider-specific request
parameter. `OPENAI_COMPATIBLE` never read `profileParameters` at all and
declared no options schema; `OLLAMA` read three keys and hardcoded the rest of
its `options` literal. Because the `parameters` column is free-form JSON that
accepts and persists anything, a key a user added saved cleanly, reloaded
cleanly, and was dropped on the way to the wire in silence — so no local model
could be run at its own publisher's recommended sampling settings, and
`reasoning_effort` was unavailable on exactly the providers where wall-clock
control matters most. The mechanism landed as an **exported helper**
(`applyProfileParameters`, plugin-utils 2.3.0) rather than a base-class method,
because measuring the graph disproved the obvious design: DeepSeek is the *only*
subclass of `OpenAICompatibleProvider`, while Z.AI and OpenRouter implement
`TextProvider` directly. Both local plugins now declare allow-lists, OAC gained
its first options schema (with `reasoning_effort` folded into
`chat_template_kwargs`, which is how `llama-server` reaches a template's
arguments), and Ollama gained per-profile `keep_alive` and thinking-effort —
both settled by measurement against a live Ollama 0.32.1 rather than by
assumption, which is what established that `keep_alive: "-1"` is refused as a
duration while the number is honoured. Carried in the same entry:
`OPENAI_COMPATIBLE` could never call a tool, blocked twice over. The `false`
capability is correct for an arbitrary endpoint and stays; what the fix removed
is that it was a ceiling — the body builds now carry `tools` and parse
`tool_calls` back. (One claim in the filing did not survive contact: the profile
editor was already seeding `allowToolUse` on new profiles only, and the checkbox
had never been disabled, so there was no clamp to remove.) Bug 69
(filed and fixed 2026-08-14) was found *while verifying* the bug 66 fix, which
needed an archived character to look at: the file watcher re-derives every
changed file's `sha256` from its bytes on disk, and an archived character's
bundle row deliberately records the digest of the **decrypted** bundle while the
disk bytes are encrypted. Seconds after every archive the watcher replaced the
content digest with a ciphertext one, and each later rehydrate refused the
bundle as corrupt — archiving had become one-way. A new
`lib/file-storage/digest-policy.ts` is now the one place that says which rows'
digests may be re-derived from disk (the watcher and the boot reconciliation
both ask it), and `restoreArchiveBundle` self-heals a row already clobbered when
the recorded digest is provably the digest of the file as stored. Bugs 66 and
67 (both filed 2026-08-14 by the v5 port's help-drift round — 66 from the
archive beats' live run, 67 from the composer-toolbar lane's send-path survey)
were fixed the same day: 66 by projecting `archivedAt` in
`getCharacterDetail`'s **two** return paths, so the chat GET the sidebar renders
from carries the archive tombstone on a fresh load — and, once a live check
showed the badge still dark, in the client's own `useParticipants` rebuild,
which had been dropping it again (so the badge could not light on *any* path,
not merely the first load the filing describes); 67 by moving "which composer surface is authoritative" into
one place — new `app/salon/[id]/composer-source-mode.ts` — so a send from the
raw-Markdown view ships the textarea's bytes rather than the suspended editor
handle's pre-toggle document, and the Send button follows the visible surface.
(One claim in 67's filing did not survive contact: Send *did* light for
source-typed text, because the textarea's `onChange` runs the page's `setInput`,
which maintains the flag; the discarded bytes are exactly as filed.) Bug 65
(filed and fixed 2026-08-13, noticed while verifying bug 64 on a fresh
instance): the version guard had been silently inert since 2026-08-12.
`version-guard.ts` reached into `migrations/lib/database-utils` with a
synchronous `require()`, and that module became an **async module** in
Turbopack's graph when the bug 58 fix added a static `instance-lock` import to
it — a sync `require()` of an async module returns an exports object that is
never populated, so every call threw `isSQLiteBackend is not a function` into a
catch that allowed startup anyway. `highest_app_version` was never stored and
`minServerVersion` never reached `.dbkey`, so an older binary would open a
newer database without complaint. Both functions are now `async` and use
`await import`; failures are announced through the migration-warnings channel
instead of dying in the log; a `no-restricted-syntax` rule fails the build on
the next sync `require` of `migrations/` from app code; and the tests assert
the *effect* rather than the absence of a throw. Bug 64
(filed and fixed 2026-08-13, from dogfooding a fresh Docker instance):
first-run encryption setup closed the main SQLite client out-of-band, but the
backend and manager singletons kept the dead handle cached — every repository
call failed with `The database connection is not open` until the process was
restarted. Teardown now runs through new `suspendDatabase()` /
`resumeDatabase()` chokepoints that recycle every handle while keeping the
backend instance (a rebuilt backend would drop the `ensureCollection` column
maps that live repositories never re-register), all three databases are
converted, and auto-lock got the same treatment. Bug
63 (filed and fixed 2026-08-13): text replacements fired inside fenced code
blocks and inline code; both the replacement plugin and the emoji typeahead
now share a `$isInCodeContext` guard. Bug 62 (filed and fixed
2026-08-13): the fallback roleplay dialogue pattern and dialogue detection both
spelled their "straight and curly" quote sets with the straight quote
duplicated, so curly-quoted dialogue had never been highlighted in any chat that
falls through to the defaults. Found while spec'ing
[composer-smart-typography](features/composer-smart-typography.md), which curls
quotes upstream of the roleplay layer and was therefore blocked on it; that
spec is now **unblocked**. Both defaults now carry the real curly code points
as `“` / `”` escapes, with fallback-path regression coverage on the
server *and* client renderers. Bug 61 (filed and fixed
2026-08-12 by the v5 port while deflaking its wardrobe e2e walk: an outfit edit
staged in the in-chat Wardrobe dialog before the worn snapshot arrives was
discarded, and the dialog closed as though it saved) is fixed by recording the
pre-snapshot gestures and **replaying them onto the snapshot** when it lands —
preserving the staged slots alone would have committed a hat and nothing else —
plus a flush that tells "nothing changed" from "we never learned what clean
was". It is **Owed** to the v5 side as a drift catch-up. Bug 57 (filed and
fixed 2026-08-11 by the v5 port's round-2 unification: the preserveIds preflight
refused a rehydrate bundle whose store carries one blob linked at two paths —
the per-link export duplication meeting an undeduped `carriedBlobIds`) converges
v4 onto the dedupe v5 had been carrying as a pinned divergence. Bug 56 came out of
dogfooding under Docker: folder creation in a filesystem store ran a recursive
`mkdir` without first checking the store's own base path existed. Bugs 52–55 all
came out of the character-archive work: 52 (cross-instance character imports
lost the vault and dangled the avatar id) was fixed 2026-08-10 by WP A2's
vault-carrying export; 53 (reconciliation clobbering and deleting archive
bundle rows), 54 (rehydrate refusing any character who shared a content row
with another vault) and 55 (a file row that outlived its bytes serving 500
instead of 404) were all found and fixed the same day, 54 and 55 by dogfooding
the merged feature on real data. Bug 51 (chat GET omitting
impersonation state, so a reload showed an impersonated seat as not impersonated)
was found and fixed 2026-08-08 while verifying Bug 50. Bugs 47–49 — the Brahma Console
giving up silently when its turn budget is exhausted, and two sibling
impersonation turn/speaking-as facets (impersonating does not hand the character
the current turn; the speaking-as seat does not follow the current user-driven
turn), all surfaced on the 2026-08-08 v5 dogfood walk — were fixed 2026-08-08.
Bug 50 (found the same day dogfooding a real roleplay: with two user-driven seats
and a single LLM, that LLM answered every human turn) was fixed 2026-08-08 too.
Each is **Owed** to the v5 side as a drift catch-up (the fixes move the oracle
baseline; Bug 47 also retires `dogfood-findings.md` #73).

**This page is the index.** Every bug lives in its own file under
[`bugs/`](bugs/); what stays here is the [Status](#status) table that points at
them and the cross-cutting v5-coordination notes.

---

## How these are filed

- **One bug, one file.** An open bug is
  `docs/developer/bugs/bug-<n>-<short-title>.md`; once its fix has landed in v4
  the same file moves to `docs/developer/bugs/fixed/`. `<short-title>` is a two-
  or three-word dashed description of the *problem*
  (`bug-9-store-delete-orphans.md`), enough to tell the files apart in a
  directory listing.
- **Numbers are permanent and sequential.** A bug keeps its number forever,
  including when it moves into `fixed/`. A new bug takes the next unused number.
- **Every file opens with a metadata table** — Status, Found, Fixed, Severity,
  Who it bites, Provenance, Fix site, v5 status, and a link back to this index —
  followed by the entry proper: symptom, root cause with file and line, why it
  survived, the fix, and how to verify it.
- **The [Status](#status) table here is the register.** Filing a new bug means
  writing the file *and* adding its row. Fixing one means `git mv`-ing the file
  into `fixed/`, filling in the Fixed date, fix site and v5 status in **both**
  the file's metadata table and its row here, and leaving a
  **`FIXED in v4 (date)`** paragraph at the top of the entry as the account of
  what was actually done.
- **Nothing is deleted.** Fixed entries keep their full root-cause write-up —
  they are the record of why the code looks the way it does, and the v5 port
  reads them.

---

## What this file is

The v5 port runs every ported unit against v4's **real** `lib/` code and diffs
the results field by field. That process occasionally finds a defect in v4
itself — a case where v5 and v4 disagree and **v4 is the one that is wrong**.

Those are recorded here with a fix plan — **one file per bug**, indexed by the
[Status](#status) table below. Each entry states the symptom, the root cause
with file and line, why it survived this long, the fix, and how to verify it.

**These are bugs, not preferences.** They are distinct from the port's much
longer list of *v4-faithful papercuts*, where v5 reproduces a v4 annoyance
exactly and any change is a product decision to be made in v4 first. That list
lives in the v5 repo (`docs/developer/porting/dogfood-findings.md`, "post-5.0
product improvements"). Nothing here is a matter of taste.

**Scope note:** this file was opened to plan the fix for **Bug 4** (the 3 MB
import bug). Bugs 1–3 come from the same audit, are listed first because they
are more urgent, and are included so the backup/restore family can be fixed in
one pass rather than three.

**Fix plan (historical):** bugs 8–43 were batched into nine session-sized,
dependency-ordered specs under [bugfix-sessions/](bugfix-sessions/README.md).
All nine have been executed; the specs are kept for the record.

---

## Provenance — Pinned, Faithful, Inert

Bugs 8 onward were surfaced by the port **after** Bugs 1–7 were fixed. The same
discipline applies throughout this catalogue: these are **bugs, not
preferences** — cases where v5 and v4 disagree and v4 is wrong, or
where v4 carries dead/broken code that silently does nothing (or the wrong
thing). The purely-taste items (a colour you'd prefer, a default you'd change)
are **not** here; they live on the v5 repo's "post-5.0 product improvements
(v4-first)" list.

Provenance is mixed. Many come from the differential harness *and are pinned in
both directions* — v5 has already taken the fix, and a v5 test asserts both "v5
is right" and "v4 is still wrong", so the day v4 converges the pin trips and
tells the v5 side to retire it. Those are flagged **Pinned**. Others were found
only by a human dogfooding real data (the harness cannot find a bug v5 reproduces
faithfully); those are flagged **Faithful** — v5 mirrors the defect exactly, so
the two sides must move together when v4 is fixed. A handful are **Inert**: dead
or unreachable code in v4 that costs no user anything today, recorded only so a
future reader does not "correct" the faithful port toward v4's broken original.

> **The coordination rule from Bugs 1–7 still holds.** A `lib/` fix here moves
> the v5 oracle baseline and obliges a v5 drift-catch-up. Land these when the v5
> side is between rounds, and expect the named tripwires to fire — a red
> differential after an upstream fix is the tripwire *working*, not a regression.

---

## The constraint that shapes the sequencing

**v4 is the oracle for the v5 port.** The port pins an oracle baseline commit
and regenerates its fixtures from it; changing v4's `lib/` moves that baseline
mid-flight and obliges a v5 drift-catch-up round.

Consequences:

- **Do not land these quietly.** Coordinate with the v5 side: a `lib/` change
  here is drift debt there. (A docs-only commit — including this file — is not:
  the port dispositions docs-only v4 commits as no-debt.)
- **Fixing v4 will turn parts of the v5 harness RED, by design.** v5 already
  diverges from v4 on all four bugs, and those divergences are asserted in
  **both** directions so that an upstream fix cannot pass unnoticed. When these
  land, the v5 side must retire the corresponding tripwires:

  | v4 fix | v5 tripwire that fires | Expected message |
  |---|---|---|
  | Bugs 1–3 | `crates/quilltap-harness/tests/system_restore_state.rs` → `assert_divergences` | *"v4 restored N rows from an archive that carries them — the v4 bug this differential pins has been FIXED upstream; re-rule the divergence"* |
  | Bug 4 | `crates/quilltap-harness/tests/system_import_equivalence.rs` → `EXPECTED_DIVERGENCES` | the `throw_ndjson_truncated_blob` case stops diverging; remove it from the list |

  A red differential after these land is **the tripwire working**, not a
  regression. The v5 work is to delete the divergence entries and let the cases
  become plain equalities.

**Suggested order:** one branch, bugs 1–3 in a single commit (they are one
repair), bug 4 in a second. Land both at a point where the v5 side is between
rounds, so the baseline moves once.

---

## Status

One row per bug, newest last. **Bug** links to the entry; **Fix site** and
**v5** are abbreviated — each bug's own file carries them in full.

| # | Bug | Found | Fixed | Severity | What goes wrong | Fix site | v5 |
|---|---|---|---|---|---|---|---|
| 1 | [restore rejects every mount point and file link](bugs/fixed/bug-1-restore-rejects-mount-points.md) | 2026-07-26 | 2026-07-26 | **Critical** | Restore rejects every `doc_mount_points` and `doc_mount_file_links` row — character vaults, project stores and group stores all come back **unreachable** | `lib/backup/restore/mount-index-coercion.ts` +1 more | Converged |
| 2 | [restore looks for files under the wrong format number](bugs/fixed/bug-2-wrong-backup-format-gate.md) | 2026-07-26 | 2026-07-26 | **Critical** | Restore looks for user files under `backupFormat === 2`, but modern manifests declare `4` — **no user file is restored** | `lib/backup/restore/archive.ts:333` | Converged |
| 3 | [the files phase runs before anything can receive the bytes](bugs/fixed/bug-3-files-phase-ordering.md) | 2026-07-26 | 2026-07-26 | **Critical** | Restore runs the files phase (5) before the stores that must receive the bytes exist (13 / 22a) — so **even with Bug 2 fixed, no file lands** | `lib/backup/restore/restore.ts` | Converged |
| 4 | [import cannot read its own export of a blob over 3 MB](bugs/fixed/bug-4-large-blob-import.md) | 2026-07-26 | 2026-07-26 | High | Import cannot read v4's own export of a document-store blob larger than **3 MB** — silent truncation, then a hard failure | `lib/import/quilltap-import-stream.ts:284` | Converged |
| 5 | [a composer run consults the wrong character's fact sheet](bugs/fixed/bug-5-wrong-character-fact-sheet.md) | 2026-07-27 | 2026-07-27 | Medium | A custom tool run from the composer tests **the first participant's** fact sheet, not the operator's own character — so metadata gates and `$state` group scope resolve as the wrong character | `app/api/v1/chats/[id]/custom-tools/route.ts` | Owed |
| 6 | [the reconcile and the cold-tier sweep fight, re-embedding the cold tier on every boot](bugs/fixed/bug-6-cold-tier-re-embedding.md) | 2026-07-28 | 2026-07-28 | High | The startup render/embed reconcile reads deliberately **cold-tiered** chats as damage and re-embeds the entire cold tier on every boot — which the next maintenance sweep clears again, forever | `lib/startup/reconcile-conversation-rendering.ts` +3 more | Inherit the fixed semantics when the reconcile is ported |
| 7 | [embedding outcomes never land: the mark methods no-op without a row nobody creates](bugs/fixed/bug-7-embedding-marks-no-op.md) | 2026-07-28 | 2026-07-28 | High | `embeddingStatus.markAsEmbedded` / `markAsFailed` are find-then-update and **silently no-op** when no status row exists — and nothing creates status rows anymore, so every embedding outcome is dropped; downstream, the reconcile keeps re-attempting permanently-unembeddable (>8k-token) chunks every boot | `lib/database/repositories/embedding-status.repository.ts` +2 more | Inherit the fixed semantics |
| 8 | [a corrupt `properties.json` is silently overwritten, losing six fields](bugs/fixed/bug-8-corrupt-properties-overwrite.md) | 2026-08-06 | 2026-08-06 | **Critical** (silent data loss) | A character's `properties.json`, if present-but-unparseable, is **silently and permanently overwritten** with defaults on the next save — six fields lost | `lib/database/repositories/vault-overlay/vault-readers.ts` +1 more | Owed |
| 9 | [deleting a document store leaves orphaned rows](bugs/fixed/bug-9-store-delete-orphans.md) | 2026-08-06 | 2026-08-06 | **High** | Deleting a document store leaves **orphaned** link/folder/document rows (non-atomic, dead delete steps, group-links never touched) — later restores fail with `FOREIGN KEY constraint failed` | `lib/mount-index/delete-store-cascade.ts` +4 more | Owed |
| 10 | [`conversation_annotations` is wiped by no delete path](bugs/fixed/bug-10-annotations-never-deleted.md) | 2026-08-06 | 2026-08-06 | **High** | `conversation_annotations` is wiped by **no delete path at all** — a privacy leak on delete-all, and `UNIQUE constraint failed` on restore into a migrated instance | `lib/backup/restore/delete-service.ts` +1 more | Owed |
| 11 | [`.qtap` import overwrite mishandles store identity three ways](bugs/fixed/bug-11-import-store-identity.md) | 2026-08-06 | 2026-08-06 | **High** | `.qtap` import overwrite: folders not cleared (stale husks), store matched by **name** (a rename misdirects it), and create mints a **fresh id** (no archive is ever re-recognised) | `lib/import/quilltap-import/import-document-stores.ts` | Owed |
| 12 | [a second-generation restore loses archived link ids](bugs/fixed/bug-12-second-generation-restore.md) | 2026-08-06 | 2026-08-06 | Medium | Restoring a **second-generation** archive loses the archived link ids and re-duplicates store rows every generation | `lib/backup/restore/carried-store-rows.ts` +1 more | Owed |
| 13 | [`gcOrphanedFileRow` throws on a mount index without the blobs table](bugs/fixed/bug-13-missing-blobs-table.md) | 2026-08-06 | 2026-08-06 | **High** (crash on 2nd write) | `gcOrphanedFileRow` issues an unconditional `DELETE FROM doc_mount_blobs` and **throws `no such table`** on any mount index that predates the lazily-created blobs table | `lib/database/repositories/doc-mount-file-links.repository.ts` | Owed (Faithful) |
| 14 | [an entity export is 99.7% regenerable embeddings](bugs/fixed/bug-14-export-embedding-bloat.md) | 2026-08-06 | 2026-08-06 | High | A single entity export is **99.7% embeddings** — the real characters `.qtap` is 789.6 MB of regenerable vectors | `lib/export/ndjson-writer.ts` +1 more | Owed (Faithful) |
| 15 | [`reindexLinkGroupSiblings` is dead code; hard-linked siblings serve stale chunks](bugs/fixed/bug-15-stale-hardlink-siblings.md) | 2026-08-06 | 2026-08-06 | Medium | `reindexLinkGroupSiblings` is **dead code** (`queryJoined` never selects `linkGroupId`) — editing a hard-linked file leaves its siblings serving **stale chunks** to search and context | `lib/database/repositories/doc-mount-file-links.repository.ts` | Owed |
| 16 | [the dimension reconcile counts mount chunks from the wrong database](bugs/fixed/bug-16-wrong-database-chunk-count.md) | 2026-08-06 | 2026-08-06 | Low | `countNonconformingMountChunks` reads `doc_mount_points` from the **wrong database**, always returns 0 — the dimension reconcile never notices non-conforming mount chunks | `lib/startup/reconcile-embedding-dimensions.ts` | Owed |
| 17 | [oversize conversation chunks can never embed](bugs/fixed/bug-17-oversize-conversation-chunks.md) | 2026-08-06 | 2026-08-06 | Medium | 515 conversation chunks are **too large to ever embed** and re-fail every boot — the renderer has no interchange sub-chunking | `lib/scriptorium/markdown-renderer.ts` +1 more | Owed (Faithful) |
| 18 | [a whitespace-only help file wipes the whole `help_docs` table](bugs/fixed/bug-18-help-docs-wipe.md) | 2026-08-06 | 2026-08-06 | Medium (latent) | A `help/` directory whose only file is **whitespace-only** wipes the **entire** `help_docs` table | `lib/help/help-doc-sync.ts` | Owed |
| 19 | [the `permanentlyFailed` embedding census is structurally always zero](bugs/fixed/bug-19-permanently-failed-census.md) | 2026-08-06 | 2026-08-06 | Low (broken diagnostic) | The `permanentlyFailed` embedding census filters `status === 'PERMANENTLY_FAILED'`, a value the enum can never hold — **structurally always 0** | `lib/tools/almanack/phase3-ledgers.ts` | Owed (Faithful) |
| 20 | [Almanack "Cast sizes" histogram groups by the raw JSON column](bugs/fixed/bug-20-cast-sizes-histogram.md) | 2026-08-06 | 2026-08-06 | Low | Almanack "Cast sizes" histogram `GROUP BY`s the raw JSON column, so it lists one row per chat instead of per cast size | `lib/tools/almanack/phase3-ledgers.ts` | `reconcile_ledger_divergences` self-retires now that v4's histogram is no longer per-cast |
| 21 | [Almanack wardrobe-permission counts under-report](bugs/fixed/bug-21-wardrobe-permission-counts.md) | 2026-08-06 | 2026-08-06 | Low | Almanack wardrobe-permission counts test `= 1` where the runtime permission is `!== false` (NULL = allowed) — **under-reports** | `lib/tools/almanack/phase3-ledgers.ts` | `reconcile_ledger_divergences` self-retires |
| 22 | [chat GET omits four controlled-select fields](bugs/fixed/bug-22-chat-get-missing-fields.md) | 2026-08-06 | 2026-08-06 | Medium | Chat GET **omits four controlled-select fields** (Story's Clock, lantern-image alerts, show-thinking, answer-confirmation override) — the select reverts to default after a successful save and never survives a reload | `app/api/v1/chats/[id]/handlers/get.ts` | Owed (Faithful) |
| 23 | [a `controlledBy` patch returns early, skipping the identity recompile](bugs/fixed/bug-23-controlled-by-early-return.md) | 2026-08-06 | 2026-08-06 | Medium | A participant patch carrying `controlledBy` **returns early**, making `compileAllIdentityStacks` and the status/`isActive` sync below it dead code | `app/api/v1/chats/[id]/helpers.ts` | Owed (Faithful) |
| 24 | [`remove-participant` returns a stale chat](bugs/fixed/bug-24-stale-chat-response.md) | 2026-08-06 | 2026-08-06 | Low | `remove-participant` returns a **stale chat** — the response still shows the removed participant as impersonating | `app/api/v1/chats/[id]/actions/participants.ts` | Owed (Faithful) |
| 25 | ["stop impersonating" is unreachable from v4's own client](bugs/fixed/bug-25-stop-impersonate-unreachable.md) | 2026-08-06 | 2026-08-06 | Medium | "Stop impersonating" is **unreachable from v4's own client**: the client sends `DELETE`, the action is registered only on `POST` | `app/api/v1/chats/[id]/handlers/delete.ts` | Converged |
| 26 | [`INSERT_RELATED` clobbers the related-memory links it just wrote](bugs/fixed/bug-26-related-memory-clobber.md) | 2026-08-06 | 2026-08-06 | Medium | On `INSERT_RELATED`, the fold pass starts `relatedMemoryIds` from `[]` and **clobbers** the links the gate just wrote | `lib/memory/memory-service.ts` +1 more | Owed (Faithful) |
| 27 | ["Speak as an AI character" is a dead affordance](bugs/fixed/bug-27-speak-as-dead-affordance.md) | 2026-08-06 | 2026-08-06 | Medium | "Speak as &lt;AI character&gt;" flips a badge but the **next message still lands as your own character** — a dead affordance | `app/api/v1/chats/[id]/actions/participants.ts` | Owed (Faithful) |
| 28 | [a Staff-signed ad-hoc announcement reaches the model anonymous](bugs/fixed/bug-28-anonymous-staff-announcement.md) | 2026-08-06 | 2026-08-06 | Medium | A **Staff-signed** ad-hoc announcement reaches the model **anonymous** — the exact anonymous block the attribution feature exists to abolish | `lib/chat/context/announcement-attribution.ts` | Owed (Faithful, both apps — it is a bug in v5 too) |
| 29 | [a user-initiated tool card wears the last speaker's face](bugs/fixed/bug-29-tool-card-wrong-face.md) | 2026-08-06 | 2026-08-06 | Medium | A **user-initiated** tool card is headed with the **last speaker's face and name** | `app/salon/[id]/group-tool-messages.ts` | Owed (Faithful) |
| 30 | ["whispered to unknown" for a user-initiated private run](bugs/fixed/bug-30-whispered-to-unknown.md) | 2026-08-06 | 2026-08-06 | Low | A user-initiated private run renders "**whispered to unknown**" instead of the operator's name | `app/salon/[id]/whisper-visibility.ts` | Owed (Faithful) |
| 31 | [OpenRouter's non-streaming path refuses vision sends](bugs/fixed/bug-31-openrouter-vision-refusal.md) | 2026-08-06 | 2026-08-06 | Medium | OpenRouter's **non-streaming** SDK path refuses vision messages at input validation — v4 sends **no image at all** on regenerate/continuation legs | `plugins/dist/qtap-plugin-openrouter/provider.ts` | Owed |
| 32 | [a stale client capability map hides OpenRouter vision](bugs/fixed/bug-32-stale-capability-map.md) | 2026-08-06 | 2026-08-06 | Low | `lib/llm/attachment-support.ts`'s hardcoded map says **OpenRouter can't do vision** while the plugin emits image parts | `lib/llm/attachment-support.ts` | Owed |
| 33 | [Grok's text and PDF attachment branches are dead code](bugs/fixed/bug-33-grok-attachment-gate.md) | 2026-08-06 | 2026-08-06 | Low | Grok's **text/\*** and **PDF** attachment branches are **dead code** (an images-only mime gate runs first) — Grok always answers "Unsupported file type" | `plugins/dist/qtap-plugin-grok/provider.ts` +1 more | Owed (Faithful) |
| 34 | [a dead base64 `catch` ships text attachments as mojibake](bugs/fixed/bug-34-base64-text-mojibake.md) | 2026-08-06 | 2026-08-06 | Low | The Anthropic/Grok text-document base64 `catch` is **dead** (`Buffer.from` never throws) — a newline-free base64-charset text attachment ships as **mojibake** | `plugins/dist/qtap-plugin-anthropic/provider.ts` +1 more | Owed |
| 35 | [the Ollama SSE splitter drops JSON split across reads](bugs/fixed/bug-35-ollama-sse-split.md) | 2026-08-06 | 2026-08-06 | Low | The Ollama SSE splitter splits each network read on `\n` with **no cross-read buffer** — a JSON object split across two reads is **silently lost** | `plugins/dist/qtap-plugin-ollama/provider.ts` | Owed (Faithful) |
| 36 | [the "tools disabled by profile" warning box is dead code](bugs/fixed/bug-36-tools-disabled-warning.md) | 2026-08-06 | 2026-08-06 | Low | The "tools disabled by connection profile" warning box is **dead code** (`undefined === false`) — no v4 user has ever seen it | `lib/services/chat-enrichment.service.ts` +1 more | Owed (Faithful) |
| 37 | [`AllLLMPauseModal` is unreachable; the pause is silent](bugs/fixed/bug-37-silent-all-llm-pause.md) | 2026-08-06 | 2026-08-06 | Low | `AllLLMPauseModal` is **unreachable** — the pause fires and writes `isPaused`, but the client is never told, so it stops with no explanation | `app/api/v1/chats/[id]/handlers/get.ts` +1 more | Owed (Faithful) |
| 38 | [the library picker lists markdown documents that 404 on attach](bugs/fixed/bug-38-markdown-attach-404.md) | 2026-08-06 | 2026-08-06 | Low | The library picker lists a store's **markdown documents**, but attaching one **404s** ("Mount-point file blob not found") — in both apps | `app/api/v1/chats/[id]/files/route.ts` +2 more | Owed (Faithful) |
| 39 | [`.qt-text-danger` is defined in no CSS, so error text is body-coloured](bugs/fixed/bug-39-missing-danger-colour.md) | 2026-08-06 | 2026-08-06 | Low (cosmetic) | `.qt-text-danger` is **defined in no CSS file** — inline error text renders in ordinary body colour | `app/styles/qt-components/_utilities.css` +1 more | the `_utilities.css` corpus vector self-retires |
| 40 | [the toolbar search dialog won't close on an outside click](bugs/fixed/bug-40-search-dialog-outside-click.md) | 2026-08-06 | 2026-08-06 | Low | The toolbar search dialog **won't close on an outside click** — `.qt-page-toolbar`'s `backdrop-filter` makes it the containing block for the `fixed` backdrop | `components/search/search-dialog.tsx` | Owed (Faithful) |
| 41 | [`Content-Disposition` mangles a filename with an apostrophe and non-ASCII](bugs/fixed/bug-41-content-disposition-apostrophe.md) | 2026-08-06 | 2026-08-06 | Low | `Content-Disposition` leaves the **apostrophe unescaped** in `filename*=UTF-8''…`, so a title with `'` **and** a non-ASCII char downloads with underscores | `lib/api/content-disposition.ts` | the `content_disposition` vector `ascii-apostrophe-with-non-ascii` self-retires |
| 42 | [toasts have no entry animation](bugs/fixed/bug-42-toast-entry-animation.md) | 2026-08-06 | 2026-08-06 | Low (cosmetic) | Toasts have **no entry animation** — the markup names keyframes (`slideInUp`) defined nowhere and a Tailwind plugin that isn't loaded | `app/globals.css` +1 more | Owed (Faithful) |
| 43 | [orphaned thumbnails are never collected](bugs/fixed/bug-43-orphaned-thumbnails.md) | 2026-08-06 | 2026-08-06 | Low (disk leak) | Orphaned `_thumbnails/` files are **never collected** when a file leaves by any route but in-app delete | `lib/background-jobs/maintenance/sweep-orphaned-thumbnails.ts` +2 more | Owed (Faithful) |
| 44 | [Bug 27's fix chose the wrong mechanism: impersonation mutates `controlledBy` instead of overlaying it](bugs/fixed/bug-44-impersonation-overlay.md) | 2026-08-06 | 2026-08-07 | Medium | Bug 27's fix mutates `controlledBy` (mutate-and-restore) instead of overlaying impersonation | `app/api/v1/chats/[id]/actions/participants.ts` +2 more | v4-FIRST (inverse direction) |
| 45 | [an impersonated seat's message flickers to the wrong author before correcting](bugs/fixed/bug-45-impersonated-author-flicker.md) | 2026-08-07 | 2026-08-07 | Low (cosmetic, self-correcting) | An impersonated seat's just-sent message flickers to the wrong author before the refetch corrects it | `app/salon/[id]/hooks/useSSEStreaming.ts` | Owed (Faithful) |
| 46 | [impersonation and the composer turn banner don't reconcile; you can't tell who you're speaking as](bugs/fixed/bug-46-composer-turn-banner.md) | 2026-08-07 | 2026-08-07 | Low–Medium (confusing; you can post as the wrong character) | Impersonation and the composer turn banner don't reconcile — the banner announces a genuine user seat's turn while attribution follows the impersonated seat, with no on-screen cue | `app/salon/[id]/SalonView.tsx` +1 more | Owed (Faithful, v4-first) |
| 47 | [the Brahma Console gives up silently when the turn budget is exhausted](bugs/fixed/bug-47-silent-budget-exhaustion.md) | 2026-08-08 | 2026-08-08 | Low (rare at the default budget of 50, but it burns real API spend and returns nothing) | Brahma Console gives up silently when the turn budget is exhausted — an expensive run ends with no answer and no `done` event | `lib/services/brahma-console/orchestrator.service.ts` + `one-shot.service.ts` (budget-exhaustion salvage) | Owed (Faithful) — retire `dogfood-findings.md` #73 |
| 48 | [impersonating a character does not hand them the current turn](bugs/fixed/bug-48-impersonate-doesnt-take-the-turn.md) | 2026-08-08 | 2026-08-08 | Low–Medium (confusing; you opt to speak as a character but it is still someone else's turn) | Impersonating a seat writes `impersonatingParticipantIds` / `activeTypingParticipantId` but never moves the turn, so the banner stays on the previously selected seat | `app/salon/[id]/SalonView.tsx` (`handleImpersonateAndTakeTurn`) | Owed (Faithful) |
| 49 | [the speaking-as seat does not follow the current user-driven turn](bugs/fixed/bug-49-speaking-as-doesnt-follow-the-turn.md) | 2026-08-08 | 2026-08-08 | Low–Medium (confusing; on an impersonated seat's own turn you default to the wrong character) | On the impersonated character's own turn the composer stays on the previously selected seat, so you default to the wrong character (sibling of Bug 48) | `app/salon/[id]/SalonView.tsx` (turn-follow effect) | Owed (Faithful) |
| 50 | [the sole LLM answers every human turn when you drive two seats](bugs/fixed/bug-50-sole-llm-answers-every-human-turn.md) | 2026-08-08 | 2026-08-08 | Medium (unfair rotation; one LLM takes half the turns) | With 2+ user-driven seats and exactly one LLM, the first responder is picked from an LLM-only shortlist, so that LLM answers every human turn (Charlie→Kumar→Lorian→Kumar…) | `lib/chat/turn-manager/selection.ts` + `lib/services/chat-message/orchestrator.service.ts` | Owed (Faithful) |
| 51 | [chat GET omits impersonation state, so a reload shows an impersonated seat as not impersonated](bugs/fixed/bug-51-chat-get-omits-impersonation-state.md) | 2026-08-08 | 2026-08-08 | Medium (reload-only; breaks impersonation + speaking-as until re-impersonated) | GET's field allowlist omits `impersonatingParticipantIds` / `activeTypingParticipantId`, so a reload drops the overlay; restoring the latter also required a once-only client re-sync | `app/api/v1/chats/[id]/handlers/get.ts` + `app/salon/[id]/hooks/useImpersonation.ts` | Owed (Faithful) |
| 52 | [a cross-instance character import produces a faceless character with a dangling avatar id](bugs/fixed/bug-52-avatar-import-dangling.md) | 2026-08-09 | 2026-08-10 | Medium (silent loss on every cross-instance character import) | `streamCharacters` exports no vault records or bytes, and reconcile never remaps `defaultImageId` / `avatarOverrides[].imageId` — the avatar (and the whole vault: photos, mail, notes) stays behind and the id dangles | WP A2 of `features/character-archive-spec.md` (`lib/export/ndjson-writer.ts` + `lib/import/quilltap-import/reconcile.ts`) | Owed (Faithful) |
| 53 | [filesystem reconciliation clobbers and can delete archive bundle rows](bugs/fixed/bug-53-reconciliation-archive-clobber.md) | 2026-08-10 | 2026-08-10 | High (a boot can delete a bundle row and dangle `archiveFileId`; at minimum every boot strips the `/archives` folderPath) | Reconciliation "corrects" ARCHIVE rows' curated folderPath to `/`, its preservation set never read `archiveFileId` (and the plaintext-sha row can't sha-match encrypted bytes), and the watcher could adopt a freshly-written bundle as an orphaned DOCUMENT | `lib/file-storage/reconciliation.ts` + `lib/characters/archive-service.ts` (`createArchiveFileRecord`) | Owed (Faithful) |
| 54 | [rehydrate refuses any character who shared a content row with another vault](bugs/fixed/bug-54-rehydrate-shared-content-collision.md) | 2026-08-10 | 2026-08-10 | High (rehydration unreachable for any character archived out of a multi-character chat; no data loss, but the archive is one-way) | Content rows are shared across vaults (a group chat's summary is one row, one link per participant); the prune deletes the target's link, so the preflight's "is it linked in the target vault?" test reads legitimately-owned content as living elsewhere and refuses atomically — stricter than the writer, which dedups by sha256 and discards the carried id | `lib/import/quilltap-import/execute.ts` (`document store file` / `document store blob` skip classifiers) | Owed (Faithful) |
| 55 | [a file row that outlived its bytes serves 500 instead of 404](bugs/fixed/bug-55-missing-file-content-500.md) | 2026-08-10 | 2026-08-10 | Low (mislabels permanent loss as a server fault; invites endless client retries and buries real storage faults in the error log) | `downloadFile` re-wraps every failure in a generic Error, so both file routes map "no such object" and "the read blew up" alike to `serverError` | new `lib/file-storage/errors.ts` + `app/api/v1/files/[id]/actions/download.ts` and `app/api/v1/files/proxy/[...key]/route.ts` | Owed (Faithful) |
| 56 | [folder creation mkdir -p's its way up an absent mount root](bugs/fixed/bug-56-unguarded-recursive-mkdir.md) | 2026-08-10 | 2026-08-10 | Medium (an opaque 500 as observed; a silent success fabricating a directory tree divorced from the store wherever the process can write to the missing ancestors) | `createFilesystemFolder` runs `fs.mkdir(target, {recursive: true})` without checking the mount's own `basePath` exists, so a store on an unreachable path (an unmounted volume, or a host path never bound into a container) sends mkdir walking up to the topmost missing ancestor | new `lib/mount-index/base-path-availability.ts` + `lib/mount-index/scanner.ts` and both mount-point routes | Owed (Faithful) |
| 57 | [rehydrate refuses any vault that links the same bytes twice](bugs/fixed/bug-57-rehydrate-duplicate-blob-claim.md) | 2026-08-11 | 2026-08-11 | Medium (High for anyone it hits: rehydrate permanently unusable for that character; the ordinary-import workaround severs id continuity) | The export's blob leg emits one record per LINK (`listByMountPoint` joins from the links), so a twice-linked sha-deduped blob appears twice in the bundle with one `blobId` — and the preflight's `carriedBlobIds` is not deduped (unlike `carriedFileIds` one list up), so the within-bundle repeat throws before Bug 54's sha-match skip is ever consulted | `lib/import/quilltap-import/execute.ts:115` — one-line `Set` dedupe | Converged (2026-08-11) — v5's pinned divergence becomes plain equality; the marker retires at the next drift catch-up |
| 58 | [migrations open the database without the instance lock](bugs/fixed/bug-58-migrations-bypass-instance-lock.md) | 2026-08-12 | 2026-08-12 | High (two processes writing one SQLCipher database — the WAL-corruption scenario the lock exists to prevent — via the heaviest writer in the codebase) | The lock is acquired by the SQLite backend's `connect()`, so every repository read and write inherits it; the migration runner holds its own connection and opened it with a bare `new Database(dbPath)`, and `instrumentation.ts` runs migrations in PHASE 1 ahead of the backend connect that would have refused | `migrations/lib/database-utils.ts` (`getSQLiteDatabase`) | Owed (Faithful) |
| 59 | [a failed read reads as an empty database and triggers first-startup seeding](bugs/fixed/bug-59-failed-read-triggers-first-startup-seeding.md) | 2026-08-12 | 2026-08-12 | High (a populated instance sent down the new-install seeding path — default characters, duplicate embedding profile, full `.qtap` import — on a transient read failure) | `findByFilter` passes `[]` as `safeQuery`'s fallback, so "no rows" and "the database is unreachable" are the same value; `seedInitialData` read that `[]` as "first startup" and began seeding an instance holding 24 characters and 10,286 messages | `lib/startup/seed-initial-data.ts` + new `countOrThrow` in `lib/database/repositories/base.repository.ts` | Owed (Faithful) |
| 60 | [the documented key-file backup procedure copies nothing](bugs/fixed/bug-60-phantom-per-database-key-files.md) | 2026-08-12 | 2026-08-12 | High (a user follows the documented backup and both `cp` commands fail; they believe the encryption key is saved when nothing was copied, and find out when the databases can no longer be opened) | The `.dbkey` path in BACKUP-RESTORE.md and DEPLOYMENT.md omits the `data/` component, and both docs plus DDL.md describe per-database key files that were never built — `quilltap-mount-index.dbkey` has never existed, and `quilltap-llm-logs.dbkey` is written only by `changePassphrase`, read by nothing, and can hold a stale wrapping | `lib/startup/dbkey.ts` + `lib/paths.ts` + `lib/startup/version-guard.ts` and the six docs/help files naming a `.dbkey` path | Owed (Faithful) |
| 61 | [a wardrobe edit staged before the worn snapshot arrives is dropped](bugs/fixed/bug-61-staged-outfit-edit-dropped.md) | 2026-08-12 | 2026-08-12 | Medium (silent data loss — the staged outfit is discarded, nothing is sent, nothing errors, and the dialog closes exactly as it does on a successful save) | Staging in the in-chat Wardrobe dialog before `refreshOutfit`'s three-round-trip chain publishes the worn snapshot is lost twice over: the first Live seed overwrites the staged slots, and the flush skips any character with no captured baseline and then returns `true`, so Done closes as if it saved | new `lib/wardrobe/staged-live-outfits.ts` + `components/wardrobe/wardrobe-control-dialog.tsx` | Owed (Faithful) |
| 62 | [the fallback dialogue pattern matches only straight quotes](bugs/fixed/bug-62-dialogue-fallback-quotes.md) | 2026-08-13 | 2026-08-13 | Medium (cosmetic but pervasive: curly-quoted dialogue had never been highlighted on the fallback path, and most model output is curly-quoted) | `DEFAULT_RENDERING_PATTERNS`' dialogue entry and `DEFAULT_DIALOGUE_DETECTION` both spelled their "straight and curly" character sets with the straight quote **duplicated** — every byte `0x22` — so curly-quoted dialogue got no `qt-chat-dialogue` styling in any chat falling through to the defaults | `lib/chat/roleplay-rendering.ts` — both defaults respelled with `“`/`”` escapes, plus fallback-path coverage in the server suite and the `MessageContent` client suite | Owed (Faithful) — moves v5's captured markdown parity corpus |
| 63 | [text replacements fire inside code blocks and inline code](bugs/fixed/bug-63-text-replacement-in-code.md) | 2026-08-13 | 2026-08-13 | Medium (silent corruption of text as the user types it, in the one place a substitution is never wanted; nothing signals it happened and the result is a plausible word, so it reads as your own typo) | `TextReplacementPlugin`'s candidate-word read checks only `$isTextNode(anchorNode)` and cursor-at-end — but `CodeHighlightNode` **extends** `TextNode`, so fenced-block tokens satisfy it, and nothing reads `hasFormat('code')` for inline runs, so both code surfaces fall straight through into the replacement path. The block-check idiom already existed in the same directory (`FormattingCommandPlugin.tsx:223-225`) and was simply not reused; the plugin had no tests at all | new `components/chat/lexical/utils/code-context.ts` (`$isInCodeContext`) shared by `TextReplacementPlugin` and the new `EmojiTypeaheadPlugin` (renamed `CharTypeaheadPlugin` in Layer 2.0u), plus the previously-missing `TextReplacementPlugin` suite | Not yet ported — v5's `textReplacementPlugin` needs the ProseMirror equivalent when it lands |
| 64 | [first-run encryption setup wedges every database connection until restart](bugs/fixed/bug-64-setup-stale-db-handle.md) | 2026-08-13 | 2026-08-13 | High (every fresh instance, at first contact; no data loss, but the whole app errors until a manual restart and nothing on screen says so) | `handleSetup` closed the main SQLite client out-of-band before converting the files to SQLCipher, but `SQLiteBackend.db` still held the closed handle behind `_state === 'connected'` and the manager's initialized-forever cache. Riders: the llm-logs client stayed open on the unlinked pre-conversion inode (log writes lost), the mount-index DB wasn't converted until the next restart, and `handleLock` shared the same pattern. Fixed by new `suspendDatabase()` / `resumeDatabase()` manager chokepoints that recycle the handles while *keeping* the backend instance — a rebuilt backend would drop the `ensureCollection` column maps that already-initialized repositories never re-register — plus a mount-index close in `disconnect()`, all three DBs converted, and an out-of-band-close self-heal in the backend | `app/api/v1/system/unlock/route.ts` (`handleSetup`, `handleLock`, `handleUnlock`) + `lib/database/manager.ts` + `lib/database/backends/sqlite/backend.ts` + `app/setup/page.tsx` | Design note for the port's key-setup flow |
| 65 | [the version guard has been silently inert since 2026-08-12](bugs/fixed/bug-65-version-guard-async-require.md) | 2026-08-13 | 2026-08-13 | Medium-High (a safety gate that reports success while doing nothing; no corruption caused by the bug, but the only barrier between an older binary and a newer database has been off since 2026-08-12, and every instance created since then has no version floor at all) | `version-guard.ts:50-54` and `:141-145` reach `migrations/lib/database-utils` with a **synchronous `require()`**. That module became an async module in Turbopack's graph when `02821db6` (the bug 58 fix) added a static `instance-lock` import to it, and a sync `require()` of an async module returns an exports object that is never populated — measured empty even a microtask later, while `await import()` of the same specifier returns all twelve exports. Every call throws `isSQLiteBackend is not a function` into a catch that allows startup anyway, so `highest_app_version` is never stored (V4test has no row; Friday is frozen at `4.8.0`) and `minServerVersion` never reaches `.dbkey` | `lib/startup/version-guard.ts` (both functions async, `await import`, failures announced through the migration-warnings channel) + `instrumentation.ts` call sites + an `eslint.config.mjs` `no-restricted-syntax` rule banning sync `require` of `migrations/` from app code; **not** by unwinding the import edge in `database-utils.ts`, which would have left the next static import free to break it again | Design note: port the version-floor *behaviour* from the bug file, not from v4's code — v4's had never actually run |
| 66 | [the archived-seat sidebar badge cannot light on a fresh load](bugs/fixed/bug-66-archived-badge-fresh-load.md) | 2026-08-11 | 2026-08-14 | Low | The chat GET the sidebar renders from enriches characters through `getCharacterDetail`, which `01e481f6` never extended with `archivedAt` — and (found while verifying) the client's `useParticipants` rebuild dropped it again, so the `Archived` badge could not light on any path | `lib/services/chat-enrichment.service.ts` (`getCharacterDetail`, both return paths) + `app/salon/[id]/hooks/useParticipants.ts` + the `EnrichedCharacterDetail` / client `CharacterData` types | v5 mirrors both projections faithfully; its archive beat pins the one-badge fresh-load state and flips with this fix |
| 67 | [a send from the raw-source view discards every source edit](bugs/fixed/bug-67-source-mode-send-discards-edits.md) | 2026-08-14 | 2026-08-14 | Medium (silent loss of typed text) | The submit reads the hidden Lexical handle unconditionally (`SalonView.tsx:1581`) while the source `<textarea>` is the visible, edited surface with the bridge suspended — the pre-edit bytes ship and the edits vanish | new `app/salon/[id]/composer-source-mode.ts` (`resolveComposerSubmitText` / `resolveComposerHasContent`) applied in `SalonView.tsx` | v5 diverges deliberately (sends what the writer sees), mutation-pinned; converges with this fix |
| 68 | [the multi-character `[Name]` prefill silently kills Ollama's thinking channel](bugs/fixed/bug-68-ollama-prefill-kills-thinking.md) | 2026-08-14 | 2026-08-14 | Medium (a paid-for feature is off with no signal — the toggle reads on, the model reasons, the reasoning is discarded before capture, and the reasoning tokens cost wall-clock either way) | Ollama's `think` support lives in the model's **chat template**, which opens the thinking block at the start of the assistant turn — so the multi-character `[Name]` assistant prefill (`context-builder.service.ts`, everything but Anthropic) means the turn has already begun with visible content and the block is never opened; `message.thinking` returns empty regardless of `think: true`. Reproduced against `localhost:11434`: same 27B, no prefill → 470 thinking chars, with prefill → 0. Ollama-only — other providers carry a protocol-level reasoning field that survives the prefill (DeepSeek 1742/5689 multi-char turns, Ollama 0/12) | The route is now the user's choice per profile: `connection_profiles.multiCharacterPrefill` (migration `add-profile-multi-character-prefill-field-v1`, backfilled Anthropic-off/rest-on) resolved through the one chokepoint `profileUsesNamePrefill` in new `lib/llm/multi-character-prefill.ts`, applied by `applyMultiCharacterTurnAnchor` in `context-builder.service.ts` with the provider hardcoding removed, and surfaced as a profile-editor checkbox. A NULL column means "never chosen" and resolves to the provider default, so a pre-4.9 Anthropic import can't come back with the prefill on. The separate greeting-path reasoning drop (`lib/chat/initial-greeting.ts` read only `chunk.content`) was fixed alongside | Not yet assessed — v5 ports the same carve-out and inherits the defect; port the per-profile setting from the bug file, not v4's pre-fix provider branch |
| 69 | [the file watcher overwrites an archive bundle's content digest, so no archived character can be rehydrated](bugs/fixed/bug-69-watcher-clobbers-archive-digest.md) | 2026-08-14 | 2026-08-14 | **High** | An archive row records the PLAINTEXT digest of an encrypted bundle; `handleFileChange` re-derives every changed file's `sha256` from disk, so seconds after each archive the row holds the ciphertext digest and every rehydrate refuses the bundle as corrupt — archiving is one-way | new `lib/file-storage/digest-policy.ts` honoured by `watcher.ts` + `reconciliation.ts`, plus a self-heal in `archive-service.ts` for rows already clobbered | Not yet assessed — any v5 watcher that re-derives digests inherits it |
| 70 | [the context budget ignores the profile's Max Context, so an unrecognised model is budgeted as 8192 tokens](bugs/fixed/bug-70-budget-ignores-profile-max-context.md) | 2026-08-15 | 2026-08-15 | **High** | Two resolutions of the model's context window on the same turn: `calculateContextBudget` used a model-name lookup only (`getModelContextLimit` → 8192 OLLAMA default for any `hf.co/...` tag) while `calculateMaxAvailable` read the profile's real 65536. The small one won where it hurts — `remainingBudget` left ~1–1.5k tokens for 4897 tokens of history, silently trimmed every turn, while compression correctly saw no need to compress and the pre-send warning validated against the same corrupt figure. Two adjacent gaps fixed alongside: the builder packed to `totalLimit − responseReserve` while the validator warned 10% lower, and the tool schemas (never in the message array) plus the post-build agent-mode / tool-change injections were spent unbudgeted and uncounted | new `resolveContextWindow` chokepoint in `lib/llm/model-context-data.ts` honoured by `getRecommendedContextAllocation` / `getSafeInputLimit` / `calculateMaxAvailable`, with `calculateContextBudget` (`lib/chat/context-manager.ts`) now taking the profile and `buildContext` passing it; `computeSafeInputLimit` as the single ceiling both sides read; new `lib/services/chat-message/turn-extras.ts` (`collectTurnExtras`) building, measuring and reserving the payload's non-context parts | Not yet assessed — any v5 budget resolving the window from the model name inherits it |
| 71 | [the two local-model providers silently drop every profile parameter, and `OPENAI_COMPATIBLE` can never call a tool](bugs/fixed/bug-71-local-provider-params-dropped.md) | 2026-08-15 | 2026-08-15 | Medium (a persisted setting that does nothing, on every local deployment) | `OPENAI_COMPATIBLE` never reads `profileParameters` and has no options schema; `OLLAMA` reads three keys and hardcodes the rest of `options`. Arbitrary keys save and reload cleanly, then vanish before the wire — so no local model can run at its publisher's recommended sampling settings (`top_k` / `min_p` / `presence_penalty` are all unreachable) and `reasoning_effort` is unavailable on the two providers where wall-clock control matters most. Separately, OAC's `toolUse: false` is a ceiling rather than a default, and the body builds carry no `tools` key either way | new `packages/plugin-utils/src/providers/profile-parameters.ts` + `openai-compatible.ts`'s allowlist hooks and tool legs (**plugin-utils 2.3.0**) + new `qtap-plugin-ollama/profile-options.ts` + OAC's first options schema + the DeepSeek and Z.AI collapses | Not yet assessed — v5's declarative manifests need a per-provider allowlist or inherit it; moves the `request-envelopes` corpus |
| 72 | [a cleared provider-option number field snaps back to the schema default and swallows the next keystroke](bugs/fixed/bug-72-cleared-number-field-snaps-back.md) | 2026-08-16 | 2026-08-16 | Medium (a wrong value reaches a real server silently — the cleared field re-reads as the default, so nothing says the keystroke was eaten) | Clearing a numeric option emits `undefined`, `setParameter` deletes the key, and `fieldValue` then falls back to `field.default` — so the default repaints with the caret after it and the next digit appends (`300`, type `5`, get `3005`, stored). Absent and explicitly-default also render identically, so "leave blank for the default" is a state the user can never see reaching | `ProviderOptionsPanel.tsx` — `NumberField` holds a draft string reconciled against `syncedFrom`; `fieldValue` returns `undefined` for number fields so the default renders as `placeholder` | Owed (Faithful) — retires dogfood finding #87 |
| 73 | [a base URL survives a provider change while its field is hidden, and permanently breaks the profile it lands on](bugs/fixed/bug-73-hidden-base-url-survives-provider-change.md) | 2026-08-16 | 2026-08-16 | **High** (a profile that cannot connect, with no visible cause and no visible cure) | Selecting `OLLAMA` fills `http://localhost:11434`; selecting `OPENAI` next hides the Base URL field but keeps the value, and all four outbound sites send it on truthiness rather than on `requiresBaseUrl` — so Connect/Fetch Models fail against the ollama port and the save writes the stale URL onto the row. `handleProviderChange` only ever *fills* a base URL, never clears one | new `outboundBaseUrl` chokepoint in `useProfileForm.ts` read by all four outbound sites (the save body always sends it, `''` clearing the row) + the two provider-judging reads in `ProfileModal.tsx` | Owed (Faithful) — retires dogfood finding #88 |
| 74 | [tagging a connection profile has never worked, three layers deep](bugs/fixed/bug-74-profile-tags-wrong-route.md) | 2026-08-16 | 2026-08-17 | Medium (a whole affordance dead end to end; the read fails silently, the write fails with a generic toast) | `TagEditor`'s `profile` branch calls `/api/v1/profiles/<id>`, a route that has never existed — so every read and write 404s. Behind it: the connection-profile GET had no `get-tags` action and answered `{profile}` for one, and `ProfileCard` read `tag.name` off `enrichWithTags`'s `{tagId, tag}` envelope, drawing every tag as an empty pill | corrected path in `tag-editor.tsx` + a strict `get-tags` GET action + new shared `resolveEditorTags` in `lib/api/middleware/enrichment.ts` + `EnrichedTag` declared and unwrapped in the profile card | Not yet assessed — v5 has no connection-profile editor; take the shape contract from the bug file |
| 75 | [importing a `.qtap` re-mints wardrobe item ids but not the composite references to them](bugs/fixed/bug-75-import-composite-id-remap.md) | 2026-08-17 | 2026-08-17 | Medium (silent: every imported composite outfit arrives hollow — equipping it clears its slots and puts nothing on) | `importCharacterWardrobeItems` strips `item.id` so `wardrobe.create` mints a fresh one, but spreads `componentItemIds` through verbatim — every composite keeps the export's old ids, which resolve to nothing in the destination | same function: pre-assigned id map, remapped `componentItemIds` (unresolvable refs dropped with a warning), leaf-first creation order, ids passed via `create`'s `options.id` | Not yet assessed — v5's importer must remap composite references whenever it re-mints item ids |
| 76 | [an api key survives a provider change, and the form sends a key the user cannot see and did not choose](bugs/fixed/bug-76-api-key-survives-provider-change.md) | 2026-08-17 | 2026-08-17 | Medium (the save is refused, not written wrong — but the refusal names a field the dialog does not show, and on a keyless provider nothing clears it; meanwhile Connect / Fetch Models / Test Message send a key the select reads as unselected) | `handleProviderChange` never clears `apiKeyId`, the select cannot express what is stored (hidden on a keyless provider, blank on a different hosted one), and all four outbound sites send it on truthiness — measured in v4's own modal: `ANTHROPIC → OLLAMA` saves `{"provider":"OLLAMA","apiKeyId":"key-anthropic"}` | new `outboundApiKeyId` chokepoint in `useProfileForm.ts` (the twin of Bug 73's) read by all four outbound sites + `handleConnect`'s validation, plus `savedProviderTakesApiKey` in `ProfileModal.tsx` | Owed (Faithful) — reproduces it; absorbs the chokepoint in a drift catch-up. Retires dogfood finding #90 |
| 77 | [the Salon's tool-execution notice pins itself above the composer and can never be dismissed](bugs/fixed/bug-77-tool-status-banner-never-clears.md) | 2026-08-17 | 2026-08-17 | Low (cosmetic but permanent — the notice holds a row of composer space for the rest of the session, with no affordance to remove it) | `toolExecutionStatus` was raised by every streaming path but torn down in one: a detached `setTimeout` at the bottom of `sendMessage`'s terminal `onDone`. Continue mode, the intermediate-done leg of a tool chain, and both error arms all left `Successfully generated 1 image!` pinned forever — and the alert had no close control | ownership moved onto the notice in `useSSEStreaming.ts`: `publishToolExecutionStatus` self-expires a settled status after 6 s (ref-held timer, cleared on unmount), `clearPendingToolExecutionStatus` drops only a stranded `pending` one at turn boundaries, `dismissToolExecutionStatus` is wired through `SalonView` to a new close button on the `ChatComposer` alert | Not yet assessed — any v5 surface pinning a tool notice from a stream event must own the expiry with the notice, not with one caller's completion path |
| 78 | [avatar generation crashes on any chat row written before the hair slot](bugs/fixed/bug-78-avatar-crash-pre-hair-outfit-rows.md) | 2026-08-18 | 2026-08-18 | High | `getEquippedOutfit` returns the stored JSON through a raw cast and the resolver indexes `slots[slot]` with no `?? []`, so a four-key pre-hair row makes `expandComposites` iterate `undefined` — `rootIds is not iterable`, the avatar job dies outside any try; the scene-state and context-manager sites degrade soft, silently losing live clothing | new `normalizeEquippedSlots` in `lib/schemas/wardrobe.types.ts`, applied in `getEquippedOutfit`; `?? []` kept at `resolve-equipped.ts:163` for direct callers; `wardrobe-create-handler` reads through the repository | Not affected — pinned both directions with a convergence tripwire (`avatar_job_tier3_equivalence` → `legacy_four_key_equipped`) |
| 79 | [`.qtap` import swallows destination read errors and proceeds into a partial apply](bugs/fixed/bug-79-import-swallows-read-errors.md) | 2026-08-15 | 2026-08-18 | Medium | `safeQuery`'s 4-arg fallback mode turns a FAILED read into "row absent" everywhere the import's reconcile leans on repository reads, so a damaged destination yields a partial, duplicated apply that reports success with zero warnings | new `strict-failures.ts` scope suspends `safeQuery`'s fallback for the duration of `executeImport` / `previewImport`; the five importers that only logged now name what they dropped in `warnings`, as does the preserveIds preflight's refusal | Fixed in v5, deliberately divergent (named skip sentences); both-direction pins retire on convergence |
| 80 | [a project's story background is ignored inside the workspace](bugs/fixed/bug-80-project-background-ignored-in-workspace.md) | 2026-08-18 | 2026-08-18 | Medium | The workspace replaced the per-view `::before` background layer with one arbitrated backdrop that views must *report* to, and suppressed the old layer inside `.qt-workspace` — but `ProjectDetailView` was never converted, so its `--story-background-url` reaches the screen by neither route. What paints instead is `ProsperoView`'s subsystem background, still registered under the tab's id after the view drilled into a project | `ProjectDetailView` reports its story background (falling back to the Prospero subsystem image for `theme` mode); the list's subsystem background moved into a `ProsperoListShell` that unmounts while a detail is shown, so one reporter holds the tab's key at a time | Not applicable — the workspace shell and its backdrop arbitration have no v5 counterpart yet |
| 81 | [an OpenAI-Compatible profile can never hold an API key](bugs/fixed/bug-81-oac-cannot-hold-an-api-key.md) | 2026-08-19 | 2026-08-19 | Medium | `requiresApiKey` answers two questions with one boolean, so OpenAI-Compatible is absent from the Add-New-API-Key provider list **and** from the profile form's key field — every hosted OpenAI-compatible endpoint that needs a bearer token is unconfigurable. Server-side, four call sites gated the key *lookup* on the same flag, so even an attached key never reached the wire | An optional `acceptsApiKey` capability answers the second question (`@quilltap/plugin-types` 2.5.7, absent = same answer as `requiresApiKey`); both UI gates and `useProfileForm`'s outbound guard read it via `lib/llm/api-key-support.ts`; the four services share `resolveConnectionProfileApiKey` | Owed |
| 82 | [three leading system messages break strict local chat templates](bugs/fixed/bug-82-three-leading-system-messages.md) | 2026-08-19 | 2026-08-19 | High (for local models) | Every non-opening turn dies with `Jinja Exception: System message must be at the beginning` on Qwen-family templates — the greeting sends one system block and works, a normal turn sends three and is refused before a token is generated | `collapseLeadingSystemMessages` (`@quilltap/plugin-utils` 2.4.0) folds the leading run at request-build time; Ollama calls it unconditionally, OAC via `acceptsRepeatedSystemMessages: false` — the flag defaults true, so hosted subclasses stay byte-identical | Owed |
| 83 | [a V8 GC race kills a jest worker and fails an arbitrary suite](bugs/fixed/bug-83-v8-sparkplug-worker-segfault.md) | 2026-08-20 | 2026-08-20 | Medium (dev tooling) | ~1 full unit run in 5 loses a worker to a SIGSEGV in V8's mark-compact ([nodejs/node#62393](https://github.com/nodejs/node/issues/62393)) and fails a different innocent suite each time; months of misattribution to the native SQLCipher binding trained a "just rerun it" reflex | `package.json` jest scripts (`node --no-sparkplug`) + `armSparkplugGuard()` in `jest.global-setup.js`, now shared by `jest.integration.config.ts` | Nothing owed (no V8 in Rust) |
| 84 | [the tool-result error sentence is carried to the client and then ignored](bugs/fixed/bug-84-tool-error-sentence-never-reaches-the-ui.md) | 2026-08-21 | 2026-08-21 | Low (cosmetic, but it defeats a field added for exactly this purpose, and hides the one sentence naming the remedy) | A failed `generate_image` shows `Failed to generate image` / `Image generation failed: Unknown error`, while the frame carried `error: "Error: Image generation is not enabled for this chat"`. The emitter hoists the text to a sibling of `result` *because `result` is null on failure* and says so in its comment; `trackToolResult` destructures only `{index, name, success, result}` and reads `result?.error`, one level too deep, so the fallback fires every time | `resolveToolResultErrorText(...)` in `app/salon/[id]/hooks/useSSEStreaming.ts` — reads the sibling `error` first, falls back to `result?.error`, and strips the executor's leading `Error: `; `trackToolResult`'s `generate_image` failure branch renders it into both the notice and the toast | Owed — v5 reproduces it exactly (`chat-stream.reducer.ts:379`, `salon-conversation.ts:2947`) and now absorbs the fix in a drift catch-up. v5 dogfood finding #99 |
| 85 | [a DeepSeek thinking model 400s on every multi-character turn](bugs/fixed/bug-85-deepseek-thinking-prefill-400.md) | 2026-08-21 | 2026-08-21 | High (every turn after the greeting 500s; one-switch workaround, but nothing points at it) | A `deepseek-v4-flash` seat greets you and then dies on every later turn with a 400: *the `reasoning_content` in the thinking mode must be passed back to the API*. The message misleads — it is not about history. The multi-character anchor appends a trailing assistant `[Name]` prefill, DeepSeek's thinking mode reads that as continuing an assistant turn and demands the reasoning that produced it, and a synthetic prefill has none. `isMultiCharacterChat` counts a single AI seat, so every character chat is affected; the greeting escapes only because it applies no anchor | Prefill-hostility scoped to **thinking-capable models, not providers**. `ModelInfo.supportsThinking`/`.thinksByDefault` + `TextProviderPlugin.thinkingTurnRule` (`@quilltap/plugin-types` 2.5.8); one pure evaluator in `lib/llm/thinking-turn.ts` run by both the host (`providerRegistry.profileRunsThinkingTurn`) and the profile editor — which is why the hook is a serialisable *rule* rather than the predicate function the filing proposed; `defaultMultiCharacterPrefill(provider, runsThinkingTurn)`; declarations in `qtap-plugin-deepseek` 1.0.20 and `qtap-plugin-ollama` 1.0.45 only, where the hostility is observed; migration `retire-prefill-on-thinking-profiles-v1` clears the stored `1`. Anthropic keeps its provider rule; a stored boolean still outranks every default | Owed — `multi_character_prefill.rs:38` carries the identical one-element hostile list. Owes the reshaped predicate, the model flags, the plugin declaration and the migration, not a list entry |
| 86 | [the DeepSeek plugin cannot tell when it is thinking](bugs/fixed/bug-86-deepseek-thinking-detection.md) | 2026-08-21 | 2026-08-21 | Low (nothing errors) | `isThinkingEnabled(body)` asks whether *we sent* `thinking: enabled`, when the question is whether the *model will reason*. A V4 profile with `parameters: '{}'` sends no `thinking` key and reasons anyway, so `stripThinkingIncompatibleParams` never runs and `temperature`/`top_p`/the penalties go out on a request that ignores them. The plugin README and the profile editor's help text carried the same misapprehension, documenting thinking as a `deepseek-v4-pro` feature | `willRunThinkingTurn(body)` (`qtap-plugin-deepseek` 1.0.21) asks the profile's explicit choice first, then the model's `thinksByDefault` from `STATIC_MODELS` — the same order as the host's `evaluateThinkingTurn`. Exact model-id match, so an uncatalogued id contributes no habit. README, model table and options-schema help text corrected | Not investigated |
| 87 | [NanoGPT's reasoning echo repeats the whole reply under a thinking fold](bugs/fixed/bug-87-nanogpt-reasoning-echo.md) | 2026-08-22 | 2026-08-22 | Medium (every affected turn renders its full reply twice; nothing errors) | NanoGPT's gateway, on some routed paths, re-emits the aggregated answer down the reasoning channel after the content stream ends — a trailing `delta.reasoning` carrying the full prose (mechanical echo, not model output: 746 completion tokens billed for a 2135-char reply that would cost that once, not twice). Plugin 1.0.1's new — and correct — `delta.reasoning` read faithfully accumulated it, and core anchored it at the end of the prose as a thinking segment. Intermittent on NanoGPT's side: identical requests minutes apart streamed clean | `streamMessage` holds post-prose reasoning in a `pendingReasoning` buffer while the run is still a verbatim prefix of the streamed content — divergence commits it in full, mirroring at stream end discards it from yields, final chunk, and `rawResponse`; `sendMessage` drops `message.reasoning` equal to `message.content` (`qtap-plugin-nanogpt` 1.0.2) | Not investigated — any v5 NanoGPT transport reading `delta.reasoning` inherits it |
| 88 | [the prompt's last block speaks of the character in the third person, ungrammatically](bugs/fixed/bug-88-tool-reinforcement-person-disagreement.md) | 2026-08-22 | 2026-08-22 | Low (nothing errors; a malformed sentence in the prompt's recency slot) | The tool reinforcement — the **last** block emitted — reads "When {{char}} uses workspace tools, *she* CALLS them", third person, immediately after the identity preamble, Taboo, and standing instructions all address the character as "you". Worse on the default path: the subject came from `character.pronouns?.subject \|\| 'they'` against verbs conjugated for a singular, so every character with no pronouns recorded — the default state — ended its prompt on "**they CALLS them** — they does not merely describe calling them". Neither was a decision: `3f4d7a78a` introduced the block with `his/her` placeholders, and `11c4d6c2d` swapped in real pronouns while *the same commit* added the second-person preamble, manufacturing the disagreement. A unit test asserted the broken string, so any accidental fix would have failed CI | Both builders (`lib/chat/context/system-prompt-builder.ts` and its hand-copied twin `lib/help-chat/system-prompt-builder.ts`) now read "When you use workspace tools, you CALL them"; the pronoun lookup is deleted, so no code path can produce the disagreement. Blame finding recorded as a `WHY` comment at the site; the defect-pinning assertion replaced with one requiring the new sentence and forbidding `CALLS them`; both cache-determinism goldens updated after confirming the sentence was the sole delta | Owed — v5's builder is a faithful port pinned by `system_prompt_equivalence`, so it is expected to reproduce both defects and absorb the fix at the next drift round. Not verified against the v5 tree |
| 89 | [the PDF rasteriser's native binary is stripped from the tarball and never put back](bugs/fixed/bug-89-napi-canvas-never-linked.md) | 2026-08-22 | 2026-08-22 | Medium (PDF rendering fails on the `npx quilltap` path; nothing else affected) | Three individually-correct pieces with nothing bridging them: `build-standalone-tarball.mjs` strips every `@napi-rs/canvas-*` platform binary from the tarball (right — a platform binary must not ride in a platform-agnostic tarball), `packages/quilltap` declares `@napi-rs/canvas` as a runtime dep so npm installs a correct one (right — that is the replacement), and `linkNativeModules` never mentioned `@napi-rs` at all. The gap is not survivable by resolution: the standalone tree lives in the download cache, far outside the npm package's `node_modules`, so Node's upward walk never reaches the installed copy — bridging exactly that is why `linkNativeModules` exists. `@napi-rs/canvas` also needs its binary as a **scope sibling**, so linking the wrapper alone would not have sufficed either | One shared `linkScopedPlatformSiblings` helper in `packages/quilltap/bin/quilltap.js` now serves both `sharp`→`@img/sharp-*` and `@napi-rs/canvas`→`@napi-rs/canvas-*`; it walks back as many segments as the wrapper's own name has, so scoped and unscoped wrappers both resolve correctly | Not investigated — any v5 launcher that prunes platform binaries from a shared tree owes the same relink step |
| 90 | [a Turbopack-built tarball smuggles the build host's native binaries to every target host](bugs/fixed/bug-90-turbopack-smuggles-build-host-natives.md) | 2026-08-23 | 2026-08-23 | **Critical** (the app cannot start — the database is unreachable, migrations fail, the server exits) | Turbopack and webpack produce structurally different standalone trees. Turbopack copies externalized packages into `.next/node_modules/<pkg>-<contenthash>/` and points requires there; webpack's NFT output uses `node_modules/<pkg>`. `build-standalone-tarball.mjs` strips natives BY NAME against `<staging>/node_modules/<pkg>` and cannot see the hashed copies, so the build-once artifact stops being platform-agnostic and carries whatever the **build host** compiled — and `build-app` runs once on x86-64 ubuntu. **Every consumer broke, not just macOS:** the tarball died with *slice is not valid mach-o file*, and `Dockerfile.ci` copies that same x86-64 artifact into the **arm64** image too, where dlopen reported the misleading *cannot open shared object file* for a file that was present but x86-64 (verified: `e_machine` `3e 00` smuggled vs `b7 00` correct, on an aarch64 container). Self-inflicted by the immediately preceding commit, which converged the bundlers in the wrong direction; the strip has never covered the Turbopack layout since 7cba1eb4, but local macOS builds hid it by compiling for the platform they ran on, and CI never executes the tarball off Linux | `--webpack` pinned at all three `next build` call sites (`release.yml`, `ci.yml`, `build-standalone-tarball.mjs`), each commented as load-bearing — plus `scripts/assert-standalone-portable.mjs`, which enforces the real invariant (no native binary anywhere under `<standalone>/.next/`) in `build-app` before the artifact is uploaded and again before the tarball is written, since a convention is exactly what a plausible-looking cleanup discards. The `loadWebpackHook` failure that motivated Turbopack is already handled by `standalone-server-bootstrap.js`, which is why webpack shipped fine from 4.5 through 4.9.0-dev.51 | Not applicable to an app-logic port; applies to any v5 packaging step that prunes natives by path out of a bundler's standalone output |
| 91 | [a vision model is handed an image its plugin never sends, and nothing says so](bugs/fixed/bug-91-image-attachments-silently-dropped.md) | 2026-08-23 | 2026-08-23 | **High** (silent data loss on the request path) | One question was asked where there were two. `profileSupportsMimeType` answers image support from the per-profile `supportsImageUpload` tick alone — a truthful claim about the **model** — while the **plugin** for NanoGPT, DeepSeek, OpenAI-Compatible and Ollama strips every attachment before the wire (`// Standard messages (strip attachments)`). Each half is survivable alone; together they cancel, because the describe-fallback is suppressed *because* the model reads images and the bytes are dropped *because* the plugin cannot send them. The model receives nothing and writes a confident paragraph about a picture it never saw. NanoGPT's own manifest said `supportsAttachments: false` and `PROVIDER_ATTACHMENT_CAPABILITIES` had no NANOGPT/Z_AI/DEEPSEEK entry at all — both sources knew, neither was in the path. The same trap poisoned describer *selection*, where an Ollama describer would invent a description from the instruction alone; the test suite had that encoded as expected behaviour | `lib/llm/image-transport.ts` (new, one predicate over the plugin registry) + `lib/chat/file-attachment-fallback.ts` (both halves must agree, at three sites) + NanoGPT plugin 1.1.0 (serialises `image_url`, keeps no vision-model list of its own — the host already decided) +1 more | **Applies.** Keep *can the model read images?* and *can the transport send them?* as two questions with one predicate each |
| 92 | [every image tool was custodial, so models used `attach_image` to try to see](bugs/fixed/bug-92-no-looking-verb-for-images.md) | 2026-08-23 | 2026-08-23 | Medium (wasted turns, dead-end error loop) | A character's whole image vocabulary was three filing verbs — `keep_image`, `attach_image`, `list_images` — with **no** looking verb anywhere in `lib/tools/`. Asked what a picture showed, models reached for the only one that sounds like engagement and were answered *Call keep_image first to save it*: filing advice to a looking question. Quilltap actively recommended the wrong verb — the Librarian's upload announcement offered `keep_image` and `attach_image` and never said a vision model was already looking. The galling part: auto-describe had written a 3,427-char description of that exact image to the FileEntry two minutes earlier, and no tool could reach it | `lib/tools/describe-image-tool.ts` (new; serves the stored description, the generation prompt, or a vision call, and does **not** require album membership — that requirement is what made `attach_image` a dead end) + `attach_image` kept but re-scoped in description and error text + Librarian copy rewritten, with a test asserting `describe_image` is named before `attach_image` | **Applies as a design rule.** A tool vocabulary needs a verb for every intent a model actually has |
| 93 | [a provider states its refusal and Quilltap answers *try resending*](bugs/fixed/bug-93-moderation-finish-reason-unhandled.md) | 2026-08-23 | 2026-08-23 | Medium | `glm-5v-turbo` returned `finish_reason: sensitive` with empty content, twice — Z.AI's moderation layer declining outright — and the Salon offered *This is a known issue with some providers. Please try resending your message.* Every clause is wrong: not a quirk but a stated refusal, and resending is guaranteed to fail, as the second attempt proved. `grep -rn sensitive lib/` returned nothing; `extractFinishReason` pulled the value correctly and its only consumers were the logger and the truncation check, while `getEmptyResponseReason` — whose entire job is explaining an empty response — inferred from three retry booleans and never took the finish reason as a parameter | `lib/llm/moderation-finish-reason.ts` (new; literal set-matching across the Z.AI / OpenAI / Azure / Google dialects — never substring, since a false positive tells a user their content was refused when it wasn't) wired into `getEmptyResponseReason`, which now names provider, model and reason and contradicts the retry advice explicitly | **Applies.** Read the provider's testimony before inferring from an empty body |
| 94 | [the attachment failure ledger had no reader](bugs/fixed/bug-94-attachment-results-never-displayed.md) | 2026-08-23 | 2026-08-23 | Medium alone; **the reason bug 91 survived** | The plugin reported the dropped attachment correctly, populating `attachmentResults.failed` with its own error text; the object was threaded through nine files and onto the SSE `done` event — and `grep -rn attachmentResults components/ app/` returned nothing. No component read it; the Salon's `SSEEvent` did not even declare the field. There is nothing to see by construction: no error, no console warning, no degraded rendering, because a model with no image writes about the image anyway. Second instance of this shape in ten bugs (bug 84 was a failing tool's `error` sibling nobody read) | `app/salon/[id]/hooks/useSSEStreaming.ts` — declare the field, warn on `done` naming the plugin's own error. A toast, not a bubble: the turn succeeded, an input to it did not | **Applies as a rule, not code.** A field plumbed end-to-end with no consumer is a latent silent failure — its cost is every bug it absorbs |
| 95 | [the image rode on the connection-profile bubble instead of the user's message](bugs/fixed/bug-95-attachment-anchored-to-wrong-message.md) | 2026-08-23 | 2026-08-23 | Medium (degraded grounding on every regenerate; total loss after a tool call) | `idx === formattedContextMessages.length - 1 && msg.role === 'user'` — two failures in one line, both downstream of a deliberate earlier fix. `normalizeWhisperRoles` re-roles Staff whispers to `user` (correctly; Anthropic 4.6+ rejects assistant tails, bug 85), after which *role is user* no longer means *the user said it*. On a fresh turn the anchor is right because `newUserMessage` is pushed last; on a **regenerate or swipe** the picture landed on a 124-char connection-profile-change bubble or a Prospero memorandum — while the Librarian's announcement in the same transcript said *the bytes ride with the user's message above*. After a tool call the tail is `assistant`/`tool`, no branch matches, and the attachments are dropped with no log line | `selectAttachmentAnchorIndex` (pure, exported, unit-tested): prefer this turn's flagged user input, then the last `role: user` message whose **source row** was a genuine human turn, then the old rule as a floor so an unanticipated shape still delivers the bytes somewhere; `-1` now warns instead of failing mutely. Needed the source row id preserved through `selectRecentMessages` and the human-turn id set captured before normalization erases it | **Applies.** Any port that re-roles whispers to `user` inherits this exactly |
| 96 | [a two-letter typo in the model's JSON reads as "this chat is fine as it is"](bugs/fixed/bug-96-title-key-typo-silent-no-rename.md) | 2026-08-23 | 2026-08-23 | Medium (a chat silently keeps its generic title, never receives a story background, and burns the checkpoint that would have retried) | `deepseek-v4-flash` answered `needsNewTitle: true` with the title under **`suggestTitle`** — the prompt asked for `suggestedTitle`. `parsed.suggestedTitle` was `undefined`, `|| null` coerced it, and the handler's guard folded *the model declined*, *the model was unreadable* and *the model agreed but we cannot find its answer* into one branch that advances the checkpoint cursor. Two symptoms, one cause: the title never changed (next retry pushed from interchange 7 to 10, where an identical stumble burns that checkpoint too), and **no story background ever generated** — `queueStoryBackgroundIfEnabled` is called only from the rename-succeeded branch and uses the new title as its `sceneContext`, so `storyBackgroundImageId` stayed `NULL` and no `STORY_BACKGROUND_GENERATION` job was ever enqueued. Invisible by construction: job COMPLETED, LLM log well-formed, spend recorded, cursor advanced exactly as a real decline would. Intermittent — the same model titled three other chats correctly the same afternoon. Both parsers carried the same 25 duplicated lines, and the help-chat copy was mislabelled `consider-title-update`, so its LLM logs were indistinguishable from the regular path's | `lib/memory/cheap-llm-tasks/title-verdict.ts` (new; one parser for both tasks, canonical key first then a short near-miss list — `suggestTitle`, `newTitle`, `proposedTitle`, `title` — with a case/separator-folding second pass, and a warning both when it recovers from a non-canonical key and when a rename is requested with nothing readable) + the handler now warns before burning a checkpoint on an unreadable verdict | **Applies.** A structured verdict from a cheap model has two failure modes and only one is *the model said no*; reading a missing field as a decision turns a provider's stumble into a product behaviour |
| 97 | [the OpenRouter registry entry denies the vision path its own provider implements](bugs/fixed/bug-97-openrouter-registry-denies-vision.md) | 2026-08-23 | 2026-08-23 | Medium (silent degradation; every OpenRouter vision profile routes to the describe-fallback, and the bug-91 describer guard refuses OpenRouter while its own sentence recommends it) | Bug 91's predicate correctly asks the plugin registry first — and the registry is wrong: `qtap-plugin-openrouter/index.ts` still declares the pre-vision conservative `supportsAttachments: false, supportedMimeTypes: []` while `provider.ts` has serialised `image_url` for four MIME types since bug 45, and the client-safe static map says so. Production (registry initialised) reads the stale `false`; jest (registry uninitialised) reads the static `true` — the a14a1811 suite is green over a branch production never takes. Found by the v5 port's differential, which runs the predicate in both configurations | `qtap-plugin-openrouter` 1.0.59 — `index.ts` declares `supportsAttachments: true` and **imports** its MIME list from `provider.ts`'s now-exported `SUPPORTED_IMAGE_MIME_TYPES` (one source, not two kept in step by comment), model-dependent caveat retained in the `description`/`notes` pair; new `__tests__/unit/lib/llm/image-transport.test.ts` exercises the registry-**initialised** branch and holds every bundled plugin's *built* declaration against the static mirror in `lib/llm/attachment-support.ts`; the describer guard's recommendation list (`lib/chat/file-attachment-fallback.ts`) gained the long-missing NanoGPT | **Reproduced faithfully** — v5's baked manifest carries the same `false` and its pins converge on the manifest regen at the drift round after the fix |
| 98 | [creating a project with a blank description has been impossible since 4.0.0](bugs/fixed/bug-98-create-rejects-blank-description.md) | 2026-08-24 | 2026-08-24 | Medium (a whole affordance refused for the default input; generic toast in Prospero, total silence on the homepage quick action, and nothing in the server log either way) | The create dialog's convention for a blank field is `null` (`onSubmit(name, description \|\| null)`), the create schema's was Zod `.optional()` — which accepts *undefined* and rejects `null` by design. `updateProjectSchema` had `.nullable().optional()` all along, so edits to empty worked while creates failed; the middleware treats the ZodError as handled, so the 400 leaves no log line, and the homepage caller had no error surface at all | `createProjectSchema` moved to `app/api/v1/projects/schemas.ts` with `.nullable()` on `description`/`instructions`/`color`/`icon`, mirroring the update schema; null/absent/string matrix pinned in `create-project-schema.test.ts`; `QuickActionsRow` gained success/error toasts | Not investigated — any v5 create path validating the dialog's `null`-for-blank convention with a non-nullable optional inherits it |

| 99 | [a character's Photo Gallery had no reachable way to download a picture](bugs/fixed/bug-99-gallery-modal-controls-under-toolbar.md) | 2026-08-25 | 2026-08-25 | Medium (under the Electron shell, which has no right-click Save Image, a photo in a character's album could not be saved at all — the affordance was present in the DOM and simply painted over) | `ImageDetailModal` puts its Download/Copy/Close cluster at `absolute top-4 right-4` inside a `fixed inset-0 z-[60]` backdrop — correct while the modal rendered under `<body>`. The tabbed workspace (`5d616727`) gave `.qt-workspace` `isolation: isolate`, so every pane's content renders inside that stacking context and `z-[60]` stopped being comparable with the sticky `.qt-page-toolbar` (`z-30`) in an ancestor context, which is painted last and wins. Nothing is clipped or mispositioned: `getBoundingClientRect()` put Download exactly where it belongs and `elementFromPoint()` there returned `.qt-page-toolbar`. Every automated signal reads normal — the buttons render, they are in the viewport, and jsdom has no compositing — so only a real hit test in a real browser can see it. Same shape as bug 40, where the toolbar's `backdrop-filter` trapped the search dialog | `ImageDetailModal` now renders through `createPortal(..., document.body)`, so its `z-[60]` resolves against the viewport again; separately the character gallery's thumbnails gained the hover **Download** button `af1bc479` gave every other grid and missed here, wired through `useGalleryData.handleDownloadImage` → `triggerDownload` so Electron gets its native save dialog | Not investigated — any v5 shell that isolates a pane's stacking context inherits this for every in-place overlay that is not portaled |
| 100 | [`qt-text-success-foreground` / `qt-text-destructive-foreground` are defined in no CSS](bugs/fixed/bug-100-qt-text-foreground-classes-inert.md) | 2026-08-25 | 2026-08-25 | Low (cosmetic) | Fifteen filled surfaces — the Set-as-avatar and Delete buttons on gallery thumbnails, the green "Avatar" badge, the solid Chat/Delete buttons in Aurora and Prospero, the file-delete confirmations — wear a class that matches no rule anywhere, so they paint their fill and then silently decline to set their text colour. Same shape as bug 39: the Tailwind utility name with a `qt-` prefix bolted on, plausible to write and not a class. The prefix looks right because the neighbouring `bg-destructive` / `hover:bg-success` / `text-primary-foreground` on the *same elements* are genuine Tailwind. Two of the fifteen are hover forms, which fail for a second reason worth keeping: Tailwind v4 generates **no variants for classes declared inside `@layer utilities`**, so `hover:qt-…` exists only where the escaped selector was written out by hand — an unwritten one is inert even when its resting counterpart is real | `app/styles/qt-components/_utilities.css` gains the rest of the family `qt-text-on-accent` started (`qt-text-on-primary`, `-on-success`, `-on-destructive`) plus the four hand-written `hover:qt-text-on-*` partners; all fifteen call sites rewritten, and bug 99's new Download button moved off the raw `hover:text-primary-foreground` it had used to avoid adding a third dead class. Mirrored into `@quilltap/theme-storybook` 1.0.62 with a "Foregrounds on filled surfaces" section in the `Surfaces` story. The wider sweep this bug's census turned up — most `hover:qt-bg-*` opacity variants inert for the identical reason — was filed and fixed the same day as bug 102 | Not investigated — any v5 port of the `qt-*` sheet inherits both the missing family and the variant rule |
| 101 | [shell completion looked its verb up by counting words](bugs/fixed/bug-101-completion-counts-words.md) | 2026-08-25 | 2026-08
| 102 | [82 `qt-*` utility classes across 493 call sites resolve to no CSS rule](bugs/fixed/bug-102-qt-utility-variants-and-opacity-inert.md) | 2026-08-25 | 2026-08-25 | Low individually, Medium in aggregate (nothing errors; ~493 elements keep whatever they inherited, and roughly half are hover states that never move) | Bug 100's census, widened from the foreground family to every utility family, and the same mechanism twice over. **Opacity steps:** Tailwind's `/50` is a modifier its engine applies to utilities *it owns*, so `qt-bg-muted/50` (34 sites) is not `qt-bg-muted` at half strength, it is a name nobody defined; the sheet had grown `/5`, `/10`, `/20` for some tokens and stopped. **Variant forms:** same cause, wider blast — Tailwind v4 generates no variants for a class declared inside `@layer utilities`, so `hover:qt-bg-muted`, the most-used state class in the app at 73 sites, styled nothing at all. The file already knew this and hand-wrote `.hover\:qt-bg-destructive\/10:hover` and eight friends; what it had no way to do was notice the ninety-odd places reaching for a form nobody wrote. Locally invisible by construction: `hover:qt-bg-muted` sits in a `className` beside `qt-bg-card` and `hover:bg-primary`, both real, and nothing on the line says one of them is fictional. A third shape rode along — names invented by analogy (`qt-text-error` 18 sites, `qt-surface-alt` 18, `qt-text-sm` 15) that were never vocabulary at all | `_utilities.css` gains the missing opacity steps, `qt-bg-input`/`qt-bg-secondary`, and a rewritten **STATE VARIANTS** section carrying all 34 `hover:`/`focus:`/`disabled:`/`placeholder:`/`file:`/named-group forms. The 24 invented names were **rewritten onto classes that already existed**, not defined — a third name for the destructive colour would have been the worse fix; one of them needed care, since `qt-text-default`→`qt-text` moves the class from the components layer to utilities and would have beaten the `qt-text-muted` it was conditionally paired with. The load-bearing half is `scripts/check-qt-classes.mjs`, run by `npm run lint`: it holds every utility-family and every variant-prefixed `qt-*` reference against the selectors the CSS defines and fails the build on one that resolves to nothing. It deliberately skips bare component classes, many of which are theme hooks meant to have no rule. Mirrored into `@quilltap/theme-storybook` 1.0.63 | Not investigated — the variant half is a Tailwind-v4 fact inherited by any port that keeps `qt-*` in `@layer utilities`; the guard is the transferable part |-25 | Medium (zsh: a subcommand's completion goes silent the moment a flag is typed; bash: the verb list is replaced by a flag list) | `quilltap docs --instance Friday <TAB>` offered nothing at all — not the verbs, not even the flags — while the same line with the flag moved *before* `docs` worked, which made it read as arbitrary. Two faults. zsh found its verb with a literal `(( CURRENT == 2 ))`, true only when the verb sits immediately after the subcommand, and its trailing `_arguments` declared no positionals, so a word position with nothing declared for it produced no matches either; worse, the top-level `_arguments -C '1: :->subcommand' … '*::arg:->args'` claimed `--instance Friday` as a *global* option even after `docs`, so the rest-argument array came back empty (`words=[]  CURRENT=1`) and the dispatcher had nothing to switch on. bash skipped a flag's value only for the global flags, so `docs --limit 5 <TAB>` read `5` as the verb, and `-i` meant `--instance` even under `memories`, which reserves it for `--ignore-case`. `completion-coverage.test.js` passed throughout — it checks that every subcommand *appears* in each template, and nothing in the suite had ever executed a completion | `packages/quilltap/lib/completion/zsh.template` — one `_arguments -C` per subcommand carrying options *and* positionals, branching on `$state`, with `(-)` on the top-level `'(-): :->subcommand'` / `'(-)*::arg:->args'` pair so a flag typed after the subcommand stays with that subcommand; `bash.template` — per-subcommand value-flag lists. Both gained live store names on every `<mount>` positional, looked up against the instance the line addresses, quoted with `compadd -a` / `printf '%q'` so `Project Files: The Estate` survives. New `completion-behavior.test.js` drives bash for real | Not investigated — v4 CLI artefacts. Any port that hand-rolls positional lookup by word index inherits the shape |
| 103 | [restore lets the table DEFAULT decide two connection-profile settings the archive predates](bugs/fixed/bug-103-restore-profile-column-defaults.md) | 2026-08-26 | 2026-08-26 | Medium (a backup older than a column comes back with that setting rewritten; for `multiCharacterPrefill` on an Anthropic profile every multi-character turn then 400s) | Restore rebuilds a row by spreading the archive record, which is what makes a *new* column ride along for free — and is exactly why a column the archive is **older than** gets no answer at all. An absent key is absent from `documentToRow`'s `Object.entries`, therefore absent from the INSERT column list, and SQLite fills it from the table DEFAULT: `multiCharacterPrefill DEFAULT 1` turns the `[Name]` prefill on (Anthropic 4.6+ hard-rejects an assistant tail), `supportsImageUpload DEFAULT 0` turns vision off. Both migrations that introduced these columns backfilled carefully — but a migration runs on the upgrade path only, and restore had no equivalent. `.qtap` import had met half of it already and seeded `supportsImageUpload` inline, so importing a bundle and restoring a backup carrying the same profile produced two different rows. `restore-field-fidelity.test.ts` was green throughout: every case there builds an archive record that *has* the field, which is the half that was already free | New `lib/llm/connection-profile-legacy-fields.ts` seeds the columns an older archive cannot carry — `supportsImageUpload` from the frozen historic provider map, `multiCharacterPrefill` as an explicit `null` so `profileUsesNamePrefill()` resolves the provider default — and both `restore.ts` and `import-profiles.ts` call it, so the two paths cannot drift again. Import's inline copy of the provider set is gone | Not investigated — any port that reconstructs rows by spreading an archive inherits it. The transferable rule is that a column with a non-neutral DEFAULT needs an explicit answer on the restore path: "absent" and "unset" are not the same value |
| 104 | [the Z.AI plugin kept its own vision list, and a new model outgrew it](bugs/fixed/bug-104-zai-private-vision-list.md) | 2026-08-26 | 2026-08-26 | Medium (silent input loss on every turn following a generated image, plus a spurious warning toast) | Bug 91's shape, third instance. The host said yes — the `Z.AI GLM 5.3 Flash` profile carries `supportsImageUpload = 1` and the plugin's registry entry declares `supportsAttachments: true`, so the describe-fallback was correctly suppressed and the raw bytes handed over. The plugin said no: a private `VISION_MODEL_PATTERNS` list matching only ids with a `v` immediately after the generation number (`glm-4.6v`, `glm-5v`) — and Z.AI's 5.3 line reads images without one, so `glm-5.3-flash` failed the regex and every attachment was dropped with *"does not support image input"* while the operator had asserted the opposite. `STATIC_MODELS` compounds it: it stops at 4.6v/5v-turbo, so every 5.x model reaches the picker via the live `/models` fetch and is a stranger to the plugin's own capability logic by construction. Caught on the first image by bug 94's toast — exactly the payoff that fix was filed for | `qtap-plugin-z-ai` 1.1.24 — delete `VISION_MODEL_PATTERNS`/`isVisionModel` and the `!modelSupportsVision` branch outright, leaving the MIME check and the missing-data check as the only ways an attachment can fail; `formatMessages` loses its now-unused `model` parameter. Matches NanoGPT's post-bug-91 shape | **Applies.** A first-party provider ships new model ids too; a regex pinned to last year's naming convention is stale the moment the vendor drops a suffix. The list is the defect, not the pattern inside it |
| 105 | [the legacy-field seeding sits outside the per-item try, so one malformed profile aborts a whole import](bugs/fixed/bug-105-seeding-aborts-import.md) | 2026-08-27 | 2026-08-27 | Medium (a `.qtap` bundle carrying one malformed connection-profile record imports nothing at all instead of naming the bad item and continuing) | `e000d6bfc` calls the new `seedLegacyConnectionProfileFields` at the top of `importConnectionProfiles`'s loop body, **outside** the per-item try, and the helper's `(seeded.provider ?? '').toUpperCase()` throws on a non-string provider — `??` guards only null/undefined — so the TypeError escapes to `executeImport`'s outer catch and aborts the whole import where the pre-4.9 code named the item and continued. Found by the v5 port's `system_import_state` differential, whose corpus deliberately carries malformed records | Both halves, because they answer different questions. `connection-profile-legacy-fields.ts` swaps the `??` for a `typeof seeded.provider === 'string'` guard, so the helper is total over junk input — an archive is data, not a contract, and a seeding helper that throws is the wrong shape of failure for one bad record. `import-profiles.ts` moves the call **inside** the per-item `try`, which is the half that contains this defect and the next one like it; the catch names `rawProfile`, since `profile` is now block-scoped to the try. Each half was verified to fail the other's regression test in isolation. The restore path was checked and needed nothing — its per-profile loop already try-wraps its whole body, seeding included, which is exactly why the two paths diverged | **Not affected** — v5 parses before it seeds and reads the provider as `as_str().unwrap_or("")`; pinned by `a_non_string_provider_is_named_and_does_not_abort_the_import` |
| 106 | [the uncensored reroute inherits a vision model's message array and hands it to a text-only fallback](bugs/fixed/bug-106-uncensored-fallback-modality.md) | 2026-08-29 | 2026-08-29 | **High** (the Concierge's last line of defence is guaranteed to fail on any turn carrying an image — the character says nothing and the chain stops) | Z.AI refused a turn outright (`finishReason: "sensitive"`, empty body, no error) and `AUTO_ROUTE` did the right thing: same-provider retry, then reroute to the configured uncensored profile. But the reroute changes the **model** and keeps the **message array** — `attemptEmptyResponseRecovery` passes its caller's `formattedMessages`, `attachments` and all, straight to `restreamInto`, and that array was built once against the *original* profile by `context-builder.service.ts:911`. `Z.AI GLM 5.3 Flash` carries `supportsImageUpload = 1`, so bug 91's predicate had correctly embedded raw bytes; the fallback `DeepSeek V4 Flash Latest` carries `supportsImageUpload = 0`, and nothing asked it — `resolveProviderForDangerousContent` selects on `isDangerousCompatible` and a decryptable key, nothing else. NanoGPT's gateway is left to find the mismatch: *400 does not support image inputs*, and the chain stops with no message at all. Bug 91's shape a fourth time, and the first where both halves answered correctly — the answer was simply computed for a model that is no longer the one being called. Every case in `provider-failover.service.test.ts` builds its history as `content: 'Hello'` with no attachments, so the suite is green over the one shape that cannot expose it | Both halves taken, plus a third the diagnosis surfaced. **Router:** `resolveProviderForDangerousContent` now takes the turn's attachment MIME types and *orders* its scan by them — candidates that can carry the payload first, the rest behind. Ordered rather than filtered, because a degraded-but-delivered turn beats no reroute when the only uncensored route is text-only, and the explicit `uncensoredTextProfileId` stays the operator's call. **Reroute:** new `adaptMessagesForProfile` (`lib/chat/message-attachment-adapter.ts`) re-runs `processFileAttachmentFallback` against the profile actually being called, so an image becomes its description and the retry proceeds; a profile that *can* take the bytes gets the same array reference back, so the common case costs nothing. **Third:** `needsVision` on the fallback chain was computed from what the user *uploaded*, not from what the array carries, so a turn whose image had already been described away was still called vision-bearing and skipped able understudies — both call sites now read `collectAttachmentMimeTypes` off the array. And the three independent spellings of "can this profile receive this attachment?" (router, describe-fallback, chain) are now one `profileCanReceiveAttachment` in `lib/llm/image-transport.ts` | **Applies.** Any port that swaps the model mid-turn without re-deciding the attachment question inherits it — the message array is shaped for the model it was built for |
| 107 | [the cheap-LLM provider budgets are walls the healthy distribution is already stacked against](bugs/fixed/bug-107-cheap-llm-budget-wall.md) | 2026-08-29 | 2026-08-29 | Medium (nothing errors and no job fails: a timed-out pass silently produces no memories, no scene state, or an uncompressed context, and is not retried) | `deadlineFor` gives a non-local cheap task 45s and compression 75s, `providerBudgetFor` hands the provider 5s less, and `buildSdkRequestOptions` turns that into `{ timeout, maxRetries: 0 }` — so the real ceilings are **40s** and **70s**, one attempt each. The successful calls say where those ceilings sit: across **1,971** completed non-compression cheap calls, **not one exceeds 40,000 ms**, and three task types peak within 600 ms of the wall (`MEMORY_EXTRACTION` 39,936 · `ANSWER_CONFIRMATION` 39,789 · `SCENE_STATE_TRACKING` 39,461). That is a censored distribution — the maxima are the budget, not the work. Compression is the same against 70s: p99 61.1s, max 67,733. **81 losses** in the first 60 hours the counter existed, every one `Request timed out.`, 61 of them on the 45s tier `8872d7efc` left alone. Not a regression — that commit *added* the `[CheapLLM] Task failed` line, so this is the first two days of a rate that was always there and invisible; its own diagnosis (*"a ceiling that most of a task's healthy distribution can reach is a ceiling set for the wrong task"*) was right and got applied to one tier. Bug 96's shape downstream: every job came back `COMPLETED` — 83 `MEMORY_EXTRACTION`, 99 `SCENE_STATE_TRACKING`, zero `FAILED` — and there is no retry, so one timeout is one permanently lost pass | All four taken. **Ceilings from the curve:** shared tier 45s → **90s** (past a tail known only to be *at least* 40s — the point is to stop cutting it so the histogram can be re-read honestly), compression background 75s → **120s**, clearing its 61.1s p99. **Asymmetry made explicit, and generalised:** a `CheapLLMLatencyClass` (`background` \| `interactive`) threads to `deadlineFor`, so the ceiling follows *who is waiting* rather than only which task it is. Compression pre-computed after delivery gets 120s; the synchronous inline call on a cache miss keeps **75s**. The shared tier splits the same way — the memory recap and the two `compressMemories` calls are awaited inline while a turn assembles and keep the old **45s**, which is also what stops the 90s raise from inverting `MEMORY_RECAP_PHASE_TIMEOUT_MS` (60s), a phase backstop documented as sitting above its own legs. **Retry:** `runCheapLLMTask` retries the same route once on a timeout only — a 401 or a refusal would fail identically — and never on the interactive path. **Visibility:** `CheapLLMTaskResult.timedOut` separates "this pass never happened" from "this pass disappointed me", and `throwIfLostToTimeout` turns the first into a thrown `CheapLLMTaskLostError` in six handlers, so `markFailed` gives it a backed-off retry and then DEAD with the reason attached. Multi-pass extraction reports it via `passesLostToTimeout` on `TurnMemoryProcessingResult`, since a per-character pass fails soft and a turn could lose half its extraction and still return `success: true`. Note the resulting extraction retry is all-or-nothing: a handler that throws in the job child has its buffered writes discarded, so the re-run is atomic and duplicate-free, at the cost of also discarding the passes that did succeed | Not investigated — the numbers are v4's, but the shape transfers: a port keeping a fixed per-task ceiling inherits the need to set it from the observed distribution, and the reporting half (a lost pass must not look like a finished one) transfers whole |
| 108 | [a `doc_str_replace` call that omits `find` is reported as "Text not found in file"](bugs/fixed/bug-108-missing-find-reported-as-text-not-found.md) | 2026-08-29 | 2026-08-29 | Medium (nothing is harmed, but the character is told to fix the one thing that is not wrong, and the agent loop spends its remaining iterations repeating the identical malformed call) | Watched live: Friday's turn against `Z.AI glm-5.3-flash` made three `doc_str_replace` calls, two of which carried `mount_point`, `path`, `replace`, `scope` and **no `find` at all** — and were answered with *"Text not found in file… use the exact text from your most recent read"*. She re-read, exactly as instructed, and repeated the same malformed call. Three correct things line up to produce it: the dispatcher deliberately falls back to RAW input when a tool's Zod parse fails (which is what lets a `qtap://` URI stand in for scope/mount/path), `handleStrReplace` guards `path` and nothing else, and `findAllMatches` answers an absent needle with `[]` — right for a *search*, but `count === 0` is the branch that blames the file. So a fault in the **call** is reported as a fault in the **content**, in the one sentence whose remedy cannot work. Invisible in aggregate, because the failure files itself under "model used stale text", where 26 of the other 33 in the corpus genuinely belong; only the recorded `arguments` object shows the absent key. Nothing logs that the parse failed, so the one signal that would have named it instantly is discarded where it is generated | `text-handlers.ts` — `find`/`replace` guards in `handleStrReplace` before the file is opened, and `position`/`content` guards in `handleInsertText` (the same hole, and the likely cause of two older `Cannot read properties of undefined` failures whose recorded arguments are `{}`). `replace` is guarded by `typeof`, not truthiness: `''` is a legitimate deletion, and without the guard an omitted `replace` splices the string `"undefined"` into the document. The dispatcher's fallback **stays** — making it fatal would cost every lenient pre-schema flow it exists for | Not investigated. The shape applies to any port that falls back to unvalidated input on a failed parse: the guard belongs at the point of use, the only place that knows which argument was needed |
| 109 | [a document's curly punctuation defeats the edit, because the model retypes it straight](bugs/fixed/bug-109-curly-punctuation-defeats-exact-match-edits.md) | 2026-08-29 | 2026-08-29 | Medium (5 of 33 `Text not found` failures on one instance, every one of them a valid edit refused) | A character reads a file, retypes a sentence into `find`, and is told the text is not there — because the file says `Veyra-5’s` and the model typed `Veyra-5's`. Re-reading cannot help; the model retypes it the same way. The direction never varies: **file curly, find straight.** Quilltap is not the curler, and that was checked first — `remark-smartypants` appears at exactly two call sites, both rendering HTML for the browser, and the keystroke engine writes only dashes and ellipses, only into what a human types; `doc_read_file` returns the bytes and `doc_str_replace` stores what it is given. The `’` is there because a **model** put it there: the Hestia case traces to a Pascal custom-tool roll whose output contained *"crosses Veyra-5’s orbit"*, stored verbatim, exactly as it should have been. The matcher forgave `Nimuë`/`Nimue` and nothing else, so a difference of *spelling* was reported as a difference of *content*. Survives because it looks like model error — 26 of the 33 genuinely are — and separates out only by comparing each find string byte-for-byte against the read that preceded it | New `lib/doc-edit/typographic-folding.ts` (quote family → `'`/`"`, dash family → `-`, `…` → `...`, non-breaking/wide spaces → `U+0020`; zero-width characters and guillemets deliberately excluded) × `diacritics.ts` gains a `foldTypography` option, off by default, and `findUniqueMatch` runs **exact first, folded only on a total miss**, returning the `tier` that answered — a file holding both spellings has one right answer and it is the one the caller typed, so an unconditional fold would turn a good edit into an ambiguity error. The two normalization paths (searched string, position map) are now built from one per-character function, so a length-changing fold maps back correctly and they cannot drift × `text-handlers.ts` turns it on for `doc_str_replace`, `doc_insert_text`'s anchor, and `doc_grep`'s literal path (unconditionally there — no uniqueness contract to protect, and a search for words is not a search for punctuation) | **Applies** — the port copies these matching semantics, and a byte-exact editing tool over model-authored prose inherits the whole defect |
| 110 | [a configured `lora_preset` is discarded whenever no adapter sits beside it](bugs/fixed/bug-110-lora-preset-discarded-without-adapter.md) | 2026-08-30 | 2026-08-30 | Medium (the generation **succeeds** and is charged for, and returns a stock image with none of the requested style — the only evidence of the loss is the picture) | `applyLoras` opens with `if (!loras || loras.length === 0) return` — true of adapters, false of `lora_preset`, whose attachment sits further down inside the `url`-dialect branch that return skips. The preset cannot arrive by the other road either: it is deliberately in `NANOGPT_LORA_SCOPED_KEYS` rather than `NANOGPT_PASSTHROUGH_KEYS`, so that it reaches only the family that understands it. Two correct decisions with no third covering the seam. The conflation underneath is the real mistake — a **preset** names a style the host already hosts and stands alone, while a **credential** (`hf_api_token`) authorises the fetch of caller-supplied weights and has no errand without them; they look alike in the options panel and the code applied one rule to both. Survives because the failure *is* a success — no error, no `dropped` entry, a completed job — and because the suite already asserted this exact call as correct (*"writes nothing for an empty or absent list"*), passing `undefined` for `profileParameters` so the preset was never in the frame | `applyLoras` resolves the family first, then applies each scoped key on its own terms: `lora_preset` whenever the family is `url`, adapter or no adapter; `hf_api_token` only inside the `weights` branch's `kept.length > 0`, with the asymmetry spelled out in a comment so it is not "consistency"-fixed back. The unknown-family refusal is untouched — that one was right. `AppliedLoras.dialect` now reports a known family's spelling even when it wrote no keys, since *nothing was configured* and *nothing could be spelled* are different diagnoses. Five regression cases, and a live tell worth recording: the same profile and prompt took **7,717 ms** with the adapter dropped and **13,338 ms** with it applied — that gap is the only externally visible difference between an applied LoRA and a silently discarded one | Not investigated. **The shape applies** to any port that groups a standalone option with the list it merely travels beside — the guard must ask about the option, not about its neighbour |
| 111 | [the only record of what an image request posted is written at a level production does not keep](bugs/fixed/bug-111-image-request-body-logged-only-at-debug.md) | 2026-08-30 | 2026-08-30 | Medium (nothing behaves wrongly, but a failed image generation is undiagnosable from the logs, and NanoGPT charges the attempt it takes to discover that) | NanoGPT answers a rejected adapter, an unreachable repo, a bad resolution and a filtered prompt with one generic 400 — *"try a different prompt or image"* — so the composed body is the only thing that separates those causes. `generateImage` logs exactly that body, at **`debug`**, and every packaged instance runs at `info`: `grep -c '"level":"debug"'` over Friday's log returns **0**. The call was also unwrapped, so the throw carried nothing plugin-specific and surfaced through the host's generic catch, which knows the message and not the request. Diagnosing three consecutive failures meant opening the SQLCipher profile row with the CLI and re-deriving the body by hand from the dialect table. The diagnostic was attached to the wrong event: written unconditionally before the call, its level must suit every success, and by the time it is wanted the level has excluded it — a line verbose when useless and absent when useful is worse than none, because its presence reads as coverage. The module's own comment had anticipated the need (*"the record of exactly what was posted"*) for the one context that would not have it | The generate call is wrapped; the failure path logs model, size, `n`, `loraDialect`, `loraKeys`, `loraDropped` and `passthroughKeys` alongside the provider's message at `error`, then rethrows unchanged. Three deliberate choices: the `debug` line **stays** (promoting it would log a body on every success to buy nothing); the throw is re-raised untouched, so this adds a record rather than becoming a handler and the host's `PROVIDER_ERROR` classification is unaffected; and it logs key **names** only, never values, which is what keeps `hf_api_token` out of the log while still recording that it was sent | Not investigated. **The shape applies** to any port whose provider adapters compose a request the transport then reports on generically — the adapter is the only layer that knows what it built, so it must be the layer that says so when the call fails |
| 112 | [a chat's "last updated" was the last time *anything* changed, so Staff announcements floated dead conversations to the top](bugs/fixed/bug-112-chat-activity-staff-messages.md) | 2026-08-30 | 2026-08-30 | Medium (nothing is lost or corrupted, but the chat list — the primary way anyone finds their way back into their work — is ordered by the wrong thing, and the wrong thing is noisier than the right thing) | `addMessage`/`addMessages` stamped `lastMessageAt` on `validated.type === 'message'`. That test separates a message from a `context-summary` or `system` event; it does **not** separate a character from the Staff. Every personified feature persists its announcements as `type: 'message'` rows carrying a `systemSender` — that is precisely what gives them an avatar and a name in the Salon — so a story background finishing its render, a summary folded, a Concierge notice, a Commonplace Book whisper, a Host announcement or a Pascal roll each stamped the chat as freshly active and displaced the conversations the user was actually in the middle of. Raw `TOOL` rows and announcement bubbles counted too. The same wrong filter was independently hand-rolled a second time in the character-conversations route, so correcting only the column would have left that list wrong. Compounding both, the display fallback was `lastMessageAt ?? updatedAt` — even a corrected column fell straight back onto the drifting timestamp for any chat where only the Staff had spoken. Survives because **the correct predicate already existed and was already in production, for something else**: `getLastPlayedMessageAt`, written for the stale-chat asset sweep, whose doc comment states outright that a Staff whisper is not activity. Nothing connected that judgement to the timestamp shown to the reader, and the sweep is invisible maintenance, so the two were never compared — leaving three different answers to "what counts as a message" in one codebase | One chokepoint, `lib/chat/chat-activity.ts`: `isCharacterAuthoredMessage` (role `USER`/`ASSISTANT`, no `systemSender`, no `customAnnouncer`), its SQLite mirror `CHARACTER_AUTHORED_MESSAGE_FILTER`, `chatActivityAt` (`lastMessageAt ?? createdAt` — never `updatedAt`) and `byChatActivityDesc`. Whispers deliberately **count**, Staff announcements and announcement bubbles and raw tool rows deliberately do not. Gated on it: both write sites; `getLastPlayedMessageAt`, so staleness and display now agree by construction; deletion, which recomputes so the column walks *backwards* when the newest character message is removed; and every reader — the character-conversations route's hand-rolled copy is gone. `recompute-chat-last-message-at-v1` rewrites the column for existing chats, clearing it to NULL where no character ever posted. `updatedAt` is untouched and keeps meaning "anything changed"; it is simply no longer what the reader is shown | Not investigated. **The shape applies** to any port that stores synthetic or system messages in the same table as conversational ones — "newest row" stops being "newest turn" the moment a non-character can write a row, and every ordering built on it silently inherits the error |
| 113 | [the folder picker latched onto its own loading state, so every destination offered only Root](bugs/fixed/bug-113-folder-picker-latched-to-root.md) | 2026-09-01 | 2026-09-01 | Medium (nothing is lost or corrupted, but every file moved into a project lands in its root, and the only way to put it anywhere else is to move it and then move it again from inside the project) | `FolderPicker` derived a correct folder list on every render and then mirrored it into a `folders` state behind `result.length > 0 && folders.length === 0`, rendering the state. The guard reads as “fill the mirror once we have something,” but the derivation **always** has something: Root is seeded unconditionally, before any data is consulted. On the first render — both queries still in flight — `result` is `[Root]`, which passes `length > 0`, and the mirror is filled with the loading state; from then on `folders.length === 1` and the guard can never pass again, so the real folders arrive and change nothing the user can see. The same latch made a change of destination inert: the query key swapped and refetched correctly, into a state sealed since the first render. It survived because the failure mode is a *plausible* dropdown — Root is genuinely always valid, so the control looks like a project with no folders rather than a broken control; nothing throws and nothing logs, and the correct list sits in `result` one line above the one that is rendered. The condition is also invisible to a reading that assumes the guard runs against settled data: `builtFolders` is an IIFE in render, not an effect, so the loading render nobody pictures is the one that wins the race | The derivation is the single source of truth and is rendered directly: `folders` is a `useMemo` over `files`, `dbFolders` and locally-created paths, so there is no mirror to latch and a destination change re-derives by construction. Module-level `NO_FILES`/`NO_FOLDERS`/`NO_PATHS` stand in for the `?? []` fallbacks so a still-loading query does not hand the memo a fresh array identity each render. The remaining state, `localFolders`, is only the offline fallback — folders created while the create API was unreachable — and carries the `projectId` it was created under, so a failed create in one project cannot offer a phantom folder in another. A *successful* create now `refetch`es rather than copying the previous render’s snapshot (the old `setFolders(builtFolders)` could not have contained the folder just created). Nesting indentation switched from ordinary spaces, which an `<option>` collapses, to non-breaking spaces | Not investigated. **The shape applies** to any port that mirrors derived data into component state behind an “only if empty” guard — the guard is satisfied by the component’s own empty first render, so the mirror is filled with the loading state and sealed |
| 114 | [a folder read that failed soft looked like a folder that wasn't there, so the image pipelines re-created the same folder on every generation](bugs/fixed/bug-114-folders-table-duplicate-rows.md) | 2026-09-02 | 2026-09-02 | Low-Medium (nothing is lost or corrupted and the one consumer de-dupes, but the `folders` table grows without bound — 607 rows for 24 real folders in Friday — and any future consumer that counts or lists without de-duping inherits the repeats) | `FolderSchema` declared `parentFolderId: UUIDSchema.nullable()` **without `.optional()`**, while the SQLite hydrator turns a NULL scalar column into `undefined`. Every root-level folder — which is every one of these — therefore threw `expected string, received undefined` inside `findOneByFilter`'s validate, and `findByPath` returned its `safeQuery` fallback of `null`: the same answer it gives for a folder that genuinely is not there. Six call sites each hand-rolled `findByPath` → `create` in front of that read, and `create` writes without reading, so every avatar and every story background generated into a project appended one more row for a folder that had existed since February. Hand-created folders show one row each because the same broken read sat in front of the same guard on the API route — a person just creates `/Gary/` once. It survived because **nothing downstream complained and the trigger was fixed without looking at what it had done**: `FolderPicker`, the sole reader, folds the rows into a `Map` keyed by path — written as the obvious way to merge table folders with file-derived ones, not as tolerance for this — so 207 rows and 1 row render identically in front of a user looking straight at the dropdown; and the Zod failure was found and fixed in April from the other end (c180246b1, one line, correct, commit message naming the exact error), with nobody asking what a read failing for two months had been *doing*. 600 rows predate that commit; the 7 that follow it contain no duplicates at all. What outlived the trigger is the structure that let it write 600 rows: no uniqueness constraint on a folder's identity, six copies of the guard, and a check-then-insert that is not atomic across the four concurrent jobs the dispatcher allows — worse in the forked child, where writes buffer to the end of the job and reads use a readonly connection, so a second job cannot see the first's create at all. `doc_mount_folders` already had both a unique index and a reconcile arm for exactly this; `folders` had neither | One chokepoint, `FoldersRepository.ensureByPath`, replacing the hand-rolled guard at all six sites (both image handlers, the file-storage watcher, both create paths in the folders route, and the `.qtap` importer), with `CREATE UNIQUE INDEX idx_folders_userId_projectId_path ON folders (userId, COALESCE(projectId, ''), path)` behind it — `projectId` coalesced because SQLite counts every NULL as distinct, same reasoning as the `doc_mount_folders` index. A unique-constraint violation resolves to the row that won rather than adding to the pile, so a concurrent create reconciles and a future soft-failing read cannot amplify past one wasted insert; a non-constraint failure is rethrown. In the job child the call is buffered whole and replayed by the parent on its RW connection (`'folders.ensureByPath': 'write'`), which is what makes it idempotent there — the in-child callers discard the return, as they must. `collapse-duplicate-folders-v1` keeps the oldest row per group, repoints any `parentFolderId` naming a discarded one at that group's survivor, deletes the rest and creates the index; `folders.parentFolderId` is the only column in the main DB referencing `folders.id`, since `files` locates its folder by `folderPath` + `projectId`. Restore drops the duplicate rows a pre-collapse backup carries, quietly rather than as warnings | Not investigated. **The shape applies** to any port whose repository reads collapse "query failed" and "no such row" into the same `null`, and whose callers answer that `null` by writing — a soft-failing read is a *write* amplifier, silent at the read and valid at each write |
| 115 | [the one cheap call a turn waits on kept the budget written for the calls nobody waits on](bugs/fixed/bug-115-interactive-distill-background-budget.md) | 2026-09-02 | 2026-09-02 | Medium (nothing errors and nothing is lost — the composer sits empty for up to three minutes per responding character, and the only evidence is that the turn eventually arrives) | `extractMemorySearchKeywords` serves two callers with opposite answers to the only question that sets a deadline: `pre-compute.service.ts` runs it after delivery (nobody waiting) and `context-manager.ts:1390` runs it inside `buildContext` with the composer empty. Only the first was ever expressed — the inline call named no tier, so it took `CHEAP_LLM_TASK_TIMEOUT_MS` (90s) **and** the timeout retry `runCheapLLMTask` grants a background pass and deliberately withholds from an interactive one. One stalled provider is 180s of nothing per responding character; the observed turn spent two such waits and a **turn pass** — three minutes for a message the user never sees — before its first visible reply at 7m16s. Bug 107 introduced `CheapLLMLatencyClass` for precisely this distinction and applied it to the compression cache miss (`context-manager.ts:1142`) and the memory recap (`memory-tasks.ts:1506`), both one branch away in the same file. The third was missed because **the new tier was applied where the old audit had already looked**: 107's evidence was a histogram by task type, and the distillation logs as `MEMORY_EXTRACTION` alongside the per-turn passes that genuinely are background — a task-type bucket cannot distinguish two callers of one function. It survived because the failure has no failure: `distill.success` is false, the branch falls back to `memorySearchQuery` (already in hand), recall degrades, and the turn arrives; nothing throws and nothing is marked FAILED. On a healthy route it is unobservable — DeepSeek-direct answered this call in 3.8–4.3s all morning | `latency: CheapLLMLatencyClass = 'background'` added to `extractMemorySearchKeywords` and threaded to `executeCheapLLMTask`; `context-manager` passes `'interactive'` (45s, and no retry — the pass is an optimisation over a query the branch already holds). The default keeps the proactive pass and `recall-replay` where they were. Verification is in two halves, because 107 had only one: `dynamic-head-distill-latency.test.ts` drives `buildContext` and asserts the argument leaves the call site (pre-fix: `Expected "interactive" / Received undefined` — not a wrong tier, an unnamed one), and four cases in `task-deadline.test.ts` cover the arithmetic 107 shipped untested, including the other direction so the proactive pass is not quietly starved. Not done: raising the interactive ceiling (re-fights 107 on one bad afternoon) or making the distillation non-blocking (changes first-turn recall, not a change to make while diagnosing latency) | Not investigated. **The shape applies** to any port where one helper serves both a blocked caller and a deferred one — the deadline belongs to *who is waiting*, so it must be a parameter, and a parameter with a safe-looking default is one the next call site will forget |
| 116 | [the describer's answer is believed without checking the image ever arrived, and the invention is then permanent](bugs/fixed/bug-116-describer-answer-never-verified.md) | 2026-09-02 | 2026-09-02 | **High** (silent fabrication written to durable storage: a confident, detailed, wholly invented description of a picture the model never saw is persisted onto `files.description`, from where it short-circuits every future reader forever — the chat turn, `describe_image`, the gallery, exports) | Everything on Quilltap's side of the wire was correct, and bug 91's gate held: nanogpt 1.2.1 emitted the `image_url` part, `image/webp` was supported, the attachment carried base64 data, and both halves of `profileCanReceiveAttachment` passed honestly. The bytes went out; NanoGPT's route for `deepseek/deepseek-v4-flash-vision-exp` discarded them, and the model answered the only thing it had — "Please describe this image in great detail" — with 683 tokens of tabby kitten for a screenshot of a warship. The response carried the proof: `promptTokens: 38`, which is `IMAGE_DESCRIPTION_INSTRUCTION` and nothing else. `describeImageWithProfile` holds **two** independent disproofs and reads neither — `response.usage` is passed to `logLLMCall` at `file-attachment-fallback.ts:410` and dropped, and `LLMResponse.attachmentResults`, which the plugin populates precisely so the host need not assume, is never consulted. What *is* checked is the response text for refusal words (`'cannot'`, `'unable to'`, length < 20) — a detector for the *polite* failure, blind by construction to the confident one, and one that reads 3175 characters of sectioned prose as the healthiest possible result. Bug 91 fixed the half we control (our plugin dropping bytes); the half left standing is the upstream dropping them, which we cannot control but can detect from a number already in hand. It then became permanent: `files.description` is written once and short-circuits `runGenerateImageDescription` and `handleDescribeImage` forever, so the user's `describe_image` call 65 seconds later was already too late to catch anything | New exported `verifyImageReachedModel` in `lib/chat/file-attachment-fallback.ts`, called from `describeImageWithProfile` **ahead of every content check** — because the failure it catches produces the healthiest-looking response in the file. Two verdicts: `attachmentResults.failed` naming the attachment (the plugin's own word that it did not send), and `usage.promptTokens` at or below a ceiling derived from `IMAGE_DESCRIPTION_INSTRUCTION` at a deliberately pessimistic 2.5 chars/token — 66 tokens, against the live call's 38 and a genuine call's ~123 on the cheapest image tier in the field. Cache reads are added back before comparing, since every plugin normalises them *out* of `promptTokens` under the 4.6.1 invariant and a cache hit would otherwise read as a dropped image; absent or zero `usage` is silence and is not failed. Either verdict returns `type: 'unsupported'` naming the profile, so the chain and the uncensored describer take their turns as after any refusal. The existing stubs in `file-attachment-fallback.test.ts` all reported 5–10 prompt tokens — the shape of the live failure — and now report a plausible vision call, with the low-token case asserted deliberately instead | **Applies.** Any port that substitutes a text description for image bytes must verify the bytes arrived before believing the text. Both proofs are on the response object; the trap is that the failure produces well-formed prose rather than an error |
| 117 | [a chat upload's FileEntry records the hash of bytes that were never stored, so every join to the document store is dead](bugs/fixed/bug-117-file-entry-sha-pre-transcode.md) | 2026-09-02 | 2026-09-02 | Medium (nothing is lost or corrupted, and the broken paths fail by returning "not found" rather than a wrong answer — but a transcoded chat upload is permanently unreachable from its own stored bytes: **118 of 239 uploaded images in Friday, every one of them a converted `image/webp`**) | `lib/chat-files-v2.ts:136` hashes the **input** buffer, then hands the bytes to a bridge that may transcode them to WebP and returns the stored bytes' hash — which is read for `storedMimeType` and `storedSize` and discarded for `sha256`. The comment three lines above `files.create` states the exact hazard (*"the FileEntry must record the stored mimeType/size, not the input"*) and is obeyed for two of the three fields; `sha256` had been computed 200 lines earlier for input-vs-input duplicate detection and simply travelled down into the row. Its sibling path gets it right: `lib/images-v2.ts:106` transcodes *first* and hashes *second*, which is why **all 2541 generated images match a `doc_mount_files` row and 118 uploads do not**. Dedup is unaffected — both `findBySha256` calls in `chat-files-v2` compare input hashes to input hashes and are internally consistent. What breaks is every cross-domain join: `auto-describe-attachment.ts:127` (so a description never reaches `extractedText`, chunks or embeddings — the image is unsearchable), `photo-handlers.ts:436`/`:497` (`attach_image` / `describe_image` cannot resolve a mount-link uuid), `save-image-to-album.ts:161`, and `photo-link-summary.ts:75`. The last is a near miss: it feeds the `album-or-vault-link` guard that stops the stale-chat sweep deleting deliberately-kept images, and a zero-linker answer there means "reap it" — the guard survives only because that sweep's candidates are filtered to `source === 'GENERATED'`, whose hashes are correct. It stayed invisible because every failure is a silent empty result that nothing writes in response to, and because an uploaded image missing from search reads as a plausible product limitation | The conflict was removed rather than adjudicated. `uploadChatFile` now calls the bridge's own `transcodeToWebP` **before** anything is hashed — the shape `images-v2.ts` has always had — so the hashed bytes are the stored bytes and one hash serves both the dedup that made the input hash attractive and the join that made it wrong; the second pass inside the bridge is a no-op on WebP. `uploadFileToProject` records the bridge's returned `sha256` beside its `mimeType` and `size`, warning if the two ever disagree. **Two columns were therefore not needed** — the residual is that sharp's encoding must stay deterministic across two uploads of one source file, which costs a missed duplicate on a version bump and nothing worse, the same bargain `images-v2` has always made. The identical drift in `import-files.ts` and `restore.ts`, both recording an archive's claimed hash over post-bridge bytes, was corrected the same way. `realign-file-entry-sha256-v1` re-derives existing rows from the blob their `mount-blob:` key names, lifting the deliberate carve-out in `repair-files-mime-and-size-from-mount-blob-v1`, whose comment and both `DDL.md` invariants now state the new rule | **Applies.** Any port that hashes content for identity must fix *which* bytes the hash names — input or stored — and speak the same answer on both sides of every join. The trap is that both answers are defensible and this codebase already contains both |
| 118 | [the NanoGPT manifest still says images are not forwarded, eleven plugin versions after they were](bugs/fixed/bug-118-nanogpt-manifest-attachment-drift.md) | 2026-09-02 | 2026-09-02 | Low (no runtime effect — nothing in `app/` or `lib/` reads `providerConfig.attachmentSupport`; it is a shipped, schema-validated, load-bearing-looking declaration stating the opposite of the truth, for exactly the provider bug 91 was about) | NanoGPT declares attachment support in three places. The built `index.ts:106` and the static mirror in `lib/llm/attachment-support.ts` both say `supportsAttachments: true` with JPEG/PNG/GIF/WebP; `manifest.json` says `supported: false`, `mimeTypes: []`, *"NanoGPT chat requests are text-only in Quilltap; attachments are not forwarded"*. `git log -S` on that sentence returns exactly one commit — `781fc4207`, the plugin's introduction. Bug 91's fix (`a14a1811d`, plugin 1.1.0) updated the code declaration and added the `NANOGPT` entry to the static mirror, and left the manifest asserting the behaviour it had just removed. NanoGPT is the **only** one of the eleven bundled plugins where the two disagree, which is what makes it a trap rather than a mess: a reader checking one manifest has no reason to suspect it of being the single stale one. The cause is that `image-transport.test.ts` holds the build and the static mirror together and excludes the manifest **deliberately** — its comment says so, citing bug 97, where the manifest was the correct copy and the build was the liar. That reasoning was right for 97 and left the manifest as the only copy with nothing checking it, and therefore the only copy free to rot; `ProviderConfigSchema` validates its shape on load, which is exactly enough to make a wrong value look maintained | `plugins/dist/qtap-plugin-nanogpt/manifest.json` now declares `supported: true` with the four MIME types from `NANOGPT_SUPPORTED_IMAGE_MIME_TYPES` and the code's own description; plugin 1.2.2 in both `package.json` and `manifest.json`, rebuilt — the built `index.js` declaration is byte-identical, since it was already right. `__tests__/unit/lib/llm/image-transport.test.ts` now loads all three declarations and holds each manifest against its own build on both `supported` and the image MIME list, with a guard test asserting the manifests were found so the block cannot pass vacuously if the plugin layout moves. The build stays authoritative and the bug-97 comment was extended rather than replaced. Whether the field should exist at all, given nothing reads it, was left open — it is what a third-party plugin author fills in first, and it is now gated | **Applies as a discipline point.** A capability declared in more than one place needs every copy under one gate, or the ungated copy is the one that rots |
| 119 | [a sub-step answering with an object instead of an array aborts the entire refinement run](bugs/fixed/bug-119-optimizer-substep-non-array.md) | 2026-09-02 | 2026-09-02 | Medium (nothing is lost or written wrongly, but a run that has already spent three or four minutes of paid model time and produced good suggestions dies on its next sub-step, surfacing `q.filter is not a function` and discarding every sub-step that had not yet run) | `runSubStep` in `character-optimizer.service.ts` asks `parseLLMJson<OptimizerSuggestion[]>(raw)` and then filters the result inline. The type parameter is an unchecked assertion — `return JSON.parse(cleaned) as T` — so a model answering `{"suggestions": [...]}`, or a lone bare suggestion object, produces text `JSON.parse` **accepts**: the surrounding `catch` (which handles *unparseable* JSON) never fires, TypeScript is satisfied, and the object reaches `.filter`. The throw escapes the sub-step, escapes the awaited chain, and is caught only by the handler that reports the whole optimization failed. The live run had already completed the analysis and two system-prompt passes, survived a third-party call failure exactly as designed, and died on the next sub-step; physical description, wardrobe, aliases and proposed new prompts never ran, and the crashing response was lost with it because `logLLMCall` sits *after* the filter chain. It survived because the cast reads as a parse wrapped in a guard, because every *other* array-shaped `parseLLMJson` site lands in a function that re-checks (`sanitizeGeneratedWardrobeItems` opens with `Array.isArray(items) ? items : []`), because well-behaved models return the bare array for months at a stretch, and because the message that reached the user was minified — `q` is `parsed` | `coerceSuggestionArray` normalises the parse result: an array passes through, a wrapper object yields the first array under `suggestions`/`items`/`results`/`data`/`amendments`, a lone object carrying `field` becomes a one-element array, anything else becomes `[]`. The call is now `parseLLMJson<unknown>`, and a non-array answer logs a warning naming the sub-step and how many suggestions were recovered — so the next occurrence is visible instead of lost with the throw. Separately, `runSubStep` became a wrapper around `runSubStepCore` that logs and continues on any throw, emitting an empty `substep_complete`: each pass is self-contained and appends to `allSuggestions`, and the two failure modes already handled inside the body say plainly that continuing was the intent. Six cases in `character-optimizer-helpers.test.ts`, including the shape observed in the wild. Not done: Zod validation at the sub-step boundary (it would drop partially-good suggestions the existing field coercion repairs), or moving `logLLMCall` ahead of the filter | **Applies.** Any port that asks a model for a JSON *array* must normalise before treating it as one, and a fan-out of independent passes must contain a failure to the pass that caused it |
| 120 | [`instances default --json` is read as an instance name, so the flag its own help documents can never fire](bugs/fixed/bug-120-instances-default-json-flag.md) | 2026-09-04 | 2026-09-04 | Low (read-only command; nothing is written and no data is at risk — but the documented invocation fails with a misleading `Unknown instance "--json"`, and a script trusting `help/cli-instances.md` gets an error line on stdout where it expected an object) | `cmdDefault` in `packages/quilltap/lib/instances-commands.js` takes **both** an options object and a positional instance name, and the `default` arm of the dispatcher called it as `cmdDefault(rest)` — one argument. Two mistakes compound: `--json` is never *read* (so `opts` defaults to `{}` and the JSON branch is unreachable), and it is never *removed* (so `args.length` is 1 rather than 0, control skips the report branch entirely, and `--json` lands in `const [name] = args` as the instance to **set**). The shape was copied from the `list` arm, which does it correctly — but `cmdList` takes *only* an options object, has no positionals, and so needs no filter; the missing step is invisible until the callee has a positional slot to corrupt. `opts = {}` let the incomplete call site run rather than fail. Nothing exercised it: the bash and zsh templates *offer* `--json` at the `instances` level, so tab-completion hands the user the broken invocation, while `completion-coverage.test.js` only checks help-text → template and cannot see that an offered flag does not work. `instances --help` never named `--json` at all, so the CLI's own reference gave no reason to try it — the sole documentation was `help/cli-instances.md`, read in-app rather than beside the code — and "Unknown instance" against a flag reads as a fumbled command line, not a parser fault | The `default` arm now filters and reads together — `cmdDefault(rest.filter((a) => a !== '--json'), { json })` — with a comment naming the positional hazard for the next person copying `cmdList`'s shape onto a command that takes positionals. Found by the v4.9 release checklist (item 12), which also closed the documentation half: `instances --help` names `--json` on the `list` line, `CLI.md` documents `instances list --json` as the scripting output and records that `--names-only` is deliberately undocumented completion plumbing, and the fish template — which offered neither — now offers `--json` on `list`/`ls`. `help/cli-instances.md` already promised the flag on both verbs; the claim is now true. Six cases in `packages/quilltap/lib/__tests__/instances-default-json.test.js` drive the real binary against a throwaway `HOME`, two of which fail against the old dispatch | **Applies.** Any hand-rolled arg parser that mixes an option into a positional slot must strip the option before reading the positional — a flag read but not removed changes what "the first argument" means |
| 121 | [an attached text file reaches the first character to answer and no one else, ever](bugs/fixed/bug-121-text-attachment-first-responder-only.md) | 2026-09-04 | 2026-09-04 | **Medium** (nothing errors and nothing is lost from disk — but in the observed six-character scene the shared document reached **1 of 13** model calls, and the other twelve reasoned from its absence: one character said so plainly, another opened "I let the transcript settle behind my eyes a moment" and then `doc_grep`'d twice for phrases from it, got `No matches found`, and carried on) | The expansion is computed per HTTP request and never written down. `fileIds` arrives only from the POST body (`request-helpers.ts:38`); `loadAndProcessFiles` builds `messageContentPrefix` from it and returns `''` when it is empty; the prefix is applied at `orchestrator.service.ts:828` into `finalUserMessageContent`, an in-memory local that travels one hop to `newUserMessage`. The row written at `:740` stores the raw `content` and a **pointer** — `attachments: options.fileIds` — and no reader turns the pointer back into prose. The second character in a multi-character turn is a fresh POST with neither `content` nor `fileIds`, assembling context from `chat_messages`, which holds the typed words alone. The one history re-hydration walk, `collectLanternImageFileIdsForCharacter`, opens with `msg.role !== 'ASSISTANT'` — correct for the Lantern backgrounds it was written for, and by construction blind to a USER message's attachments, so a user-uploaded **image** was one-shot in exactly the same way. Live evidence: Friday chat `df82edc2`, log `9757495e` carries 28,941 characters of transcript and `[End of attached file]`; `4f949c47` and eleven others carry 224 characters | Re-hydrated on read rather than persisted, so the file stays the single source of truth and chats that already exist are repaired too. `collectUnseenUserAttachmentsForCharacter` is the USER-side counterpart of the Lantern walk — same tail-walk and same "stop at the character's own prior response" rule, keyed on `role: USER`, returning `{ messageId, fileIds }` so each file is spliced back in **at the message that carried it** rather than restated at the tail. That stop rule doubles as the budget: once apiece, never once a turn. The two walks now share `isCharactersOwnPriorResponse` and one hoisted `attachmentHistoryCutoff`. `rehydrateUserAttachments` reuses the **same** `processFileAttachmentFallback` pass as the upload path, which is what makes it general rather than text-specific — inline text, described image, or raw bytes for a provider with vision, the last joining `mergedAttachmentsToSend` and anchored like a Lantern image. It runs **before** `buildContext` so the tokens are budgeted and trimmed like any other body (the Lantern prefix is spliced after budgeting, affordable for a description and not for a 29 KB transcript), under an 80k-character per-turn ceiling that skips rather than truncates, since half a transcript is a worse input than none. Ten walker cases plus V4test end-to-end: the second character quoted the planted phrase verbatim, and three participants independently read the same PNG | **Applies.** Any port that expands an attachment into prompt text at request-assembly time and persists only the user's typed words inherits this whole. The lesson is about *where* the expansion is stored, not how it is produced |
| 122 | [a character is handed other people's memories as their own autobiography](bugs/fixed/bug-122-unattributed-self-memories.md) | 2026-09-05 | 2026-09-05 | **High** (nothing errors and the turn reads *well* — the character simply answers as somebody else; in the observed scene a male test engineer wrote a woman's reply about breastfeeding her daughter, in her voice, with her history, and the prose was the only evidence) | A character's memory store is keyed on `characterId` alone: it holds what they remember about themselves **and** about everyone else, separated only by `aboutCharacterId`. Four formatters render memories into context and exactly one — `formatInterCharacterMemoriesForContext` — says whose life a line describes. The other three (`formatFrozenMemoryArchive` → `## Memory Anchors`, `formatDynamicMemoryHead` → `Most relevant memories for this turn:`, `formatMemoriesForContext` → `## Relevant Memories`) printed the bare summary, and their pools filter by subject no more than they label it. `buildCommonplaceLLMContext` then heads all three with **"You remember the following entries that bear on this moment"**, so `struggles to become offered mother` (Marion's) and `reassured Marie about her wish` (Marion's) reached Kumar as autobiography. The same memory `11de858e` appeared twice in one whisper — correctly attributed under *"You also recall about the others present"*, and confessed as Kumar's own two sections above. Guardrails that had been masking it were all absent at once: a cheap model, and `multiCharacterPrefill: 0` (from bug 85), so no trailing `[Kumar]` anchor sat between those memories and the first generated token | One required `MemorySubjectContext` + `formatMemorySubjectPrefix` in `lib/chat/context/memory-injector.ts`, threaded through all three self-facing formatters — required, not optional, because omission is how this arrived. `buildMemorySubjectContext` (`lib/memory/memory-subject.ts`) resolves the pool's foreign subjects, querying nothing for a first-person store, via the new `CharactersRepository.findNamesByIds`, which skips the vault overlay so an unreadable vault costs a *name*, not the turn. An unresolved id still gets `About another character: ` — breaking the first-person reading is the job; the name is the nicety +2 more | **Applies.** Any port that stores "what I remember" and "what I remember about you" in one owner-keyed table and renders either under a second-person heading inherits this exactly. A *pool* and a *voice* are two different questions |
| 123 | [a paused chat goes quiet without saying so, and the Salon cannot tell it is paused](bugs/fixed/bug-123-silent-pause-sync-drift.md) | 2026-09-05 | 2026-09-05 | **Medium** (nothing errors and nothing is lost — the room simply stops answering: one reply per message, nudges still work, the Skip button comes and goes, and the sidebar reads *Pause* throughout; the only cure was a page reload the user had no reason to try) | Three defects stacked. The client's pause sync (`useChatControls.ts:159`) keyed on a *transition* of the fetched `chat.isPaused`, and the Resume button flipped local state without updating the fetched object — so after a chain-error pause, a Resume, and a second chain-error pause with no unpaused fetch in between, the fetched value went `true → true`, the effect never fired, and the client believed the chat live while the server held it paused; every later nudge and Skip ran without the unpause they perform when they *know*. The chain guard (`turn-orchestrator.service.ts:322`) returned on a paused chat with no chain-complete event and no log line, so each user message drew one reply and a closed stream. And the Skip banner was keyed on whose turn the client's rotation *thought* it was, which lands on the human's seat only sometimes — hiding the button on exactly the turns where the paused chat was going to do nothing | `useChatControls.ts` (reconcile on every fetch; `setPauseState` writes the fetched chat) + `turn-orchestrator.service.ts` (paused early-return emits `chainComplete { reason: 'paused', paused: true }`; every chain-complete carries `paused`) + `useSSEStreaming.ts` (`announceChainPause`) + `SalonView.tsx` / `useTurnManagement.ts` (Skip offered for the seat the composer speaks as, impersonated or owned; lifts a pause first) | **Applies.** Reconcile on every fetch, never stop a chain without an event — port the rules, not v4's pre-fix shape |
| 124 | [a help chat's tool results never reach the model on most providers, so a tool-needing question ends in silence](bugs/bug-124-help-tool-rows-lack-ids.md) | 2026-09-06 | — (**UNCONFIRMED on live v4** — found on the v5 port's Friday copy; v4 read from source) | **Medium** (silence, not an error — the dialog shows nothing after a question that needs `help_search`/`help_navigate`; a Google seat answers) | The help loop pushes its tool results as `{ role: 'tool', content }` with no `toolCallId` (`lib/services/help-chat/orchestrator.service.ts:509`), and every plugin but Google drops an id-less tool row (`qtap-plugin-nanogpt/provider.ts:174` and seven siblings) — the model never sees a result, repeats the search, and the duplicate-call guard forces an empty final | `lib/services/help-chat/orchestrator.service.ts` (thread the `toolCallId`, as `tool-call-threading.ts:94` does for the Salon) | **Reproduces faithfully** (the per-provider drop ported at `p4.9i2`); absorbs the fix at the next drift catch-up — finding #112 |
| 125 | [Google refuses every tool-enabled turn whose slate holds the wardrobe tools](bugs/bug-125-google-rejects-nested-additional-properties.md) | 2026-09-06 | — (**UNCONFIRMED on live v4** — the 400 was Google's, against the v5 port; v4 sends the same declarations by source reading) | **High if confirmed** (a Google seat cannot take one tool-enabled turn with `wardrobe_wear`/`wardrobe_take_off` in its slate — the help slate always has them) | `sanitizeSchemaForGoogle` (`qtap-plugin-google/provider.ts:63`) strips `UNSUPPORTED_SCHEMA_FIELDS`, which lacks `additionalProperties`; the top-level one is dropped by construction, the one under `operations.items` on the two wardrobe tools survives, and Google answers `Unknown name "additionalProperties" at '…properties[0].value.items'` | `plugins/dist/qtap-plugin-google/provider.ts:33` (add `additionalProperties` to the list) | **Reproduces faithfully** (list mirrored entry for entry; tool JSON byte-copied); blocks the GOOGLE tool-row live proof; the google-wire corpus needs a nested-object row — finding #114 |

### Families and reading order

Bugs 1–3 are one repair: **all three must land together** or restore is still
broken. Bug 2 alone changes nothing, because Bug 3 means there is nowhere to
put the bytes.

Bug 5 is unrelated to the backup/restore family and stands alone. It is the
first entry here that did **not** come from the differential harness — the
harness could not have found it, because v5 reproduces the behaviour exactly.
It took a human running a tool in a real chat and getting the wrong answer.

Bugs 9–12 are one family (backup / restore / import integrity) and are best
fixed together, the way Bugs 1–4 were. Bug 8 was the single most urgent item in this
catalogue — it ran against live data and the loss was silent and permanent.

An [Inert dead code](#inert-dead-code) appendix lists a further set of
faithfully-ported-but-dead v4 code paths that bite no user today.

### v5 coordination

**Bugs 1–46 are fixed in v4. Bug 44 (the impersonation overlay) landed
2026-08-07; Bugs 45 and 46 landed 2026-08-07. The 1–43 close-out: the last batch, bugs 31–35,
on 2026-08-06** (bugs 8–12, 18, and 26 fixed earlier). Their
per-bug fix sites and v5 status are in the [Status](#status) table and, in full,
in each bug's own file. The coordination surface, as they were taken, is these
tripwires the v5 side must retire the day v4 converges:

| v4 fix | v5 tripwire that fires | Where |
|---|---|---|
| 8 — properties.json clobber | the `corrupt` arm of `characters_update_tier2_equivalence` | both assertions go red |
| 9 — store-delete orphans | `store_delete_equivalence` (7 arms, `reap_orphans`) | "v4 has CONVERGED — retire this divergence" |
| 10 — annotations wipe | `system_delete_data_equivalence` → `ANNOTATION_DIVERGENCE_KEY` | v5 = 0, oracle must be non-zero |
| 11 — import overwrite trio | `system_import_state` → `FOLDER_CLEAR_DIVERGENCE`, `STORE_ID_PRESERVED_ON_CREATE`, `store_identity_*` | one per defect |
| 12 — second-gen restore | `system_restore_state` dedupe arms | ruled `REPLAY_DEDUPE` |
| 15 — link-group siblings | `doc_mount_file_links_tier2_equivalence` → `CHUNK_DIVERGENCES` | fresh on v5 / stale on v4 |
| 16 — mount-chunk count | `embedding_dimension_reconcile` (`mountChunks == 0`) | mutation-tripwire |
| 20 / 21 — Almanack ledgers | `almanack_tier2_equivalence` → `reconcile_ledger_divergences` | self-retiring |
| 39 / 41 — CSS / disposition | `_utilities.css` corpus; `content_disposition` vector `ascii-apostrophe-with-non-ascii` | vanished divergence fails loud |

The **Faithful** items (13, 14, 17–19, 22–38, 40, 42, 43, and the inert list)
carry no both-directions pin — v5 reproduces them exactly, so the two sides
simply disagree once v4 is fixed. Each must be mirrored on the v5 side **in the
same round** v4 lands it, or the port falls out of step with its own oracle. Bug
8 is the exception that is also urgent: it is live data loss against real
instances, and should not wait for a convenient round.

**Bug 44 runs the OTHER way**: v5 already mirrors the shipped (wrong)
mechanism faithfully, so there is no v5 tripwire and nothing for v5 to do
first — v4 lands the overlay correction between v5 rounds and tells the
port, whose `salon_mutations` / `chat_cast_routes` / turn-chain families
then move as ordinary drift.

Bugs 1–4 had been ruled deliberate divergences on the v5 side (2026-07-24 and
2026-07-25) rather than being reproduced bug-for-bug, on the grounds that they
sit on the data-loss path. The v5 rulings are recorded in that repo's
`docs/developer/porting/status-log.md` under "Ruling — the sparse-array blob
divergence" and "Ruling — the two v4 restore bugs".

### Decisions taken while fixing

- **Bug 1 was fixed on the restore side only**, per the recommendation above.
  The backup side is untouched, so archive bytes do not change and the v5
  oracle's *backup* fixtures do not move. The coercion tolerates already-correct
  input (parse only when the value is a string, coerce only when it is a
  number), so a later backup-side normalisation can land without a second
  change here.
- **Bug 3 renumbers by insertion, not renumbering.** The moved block is
  labelled `22a-bis` and step 5 keeps a placeholder comment explaining the
  deferral — the same idiom step 19 already uses for wardrobe items deferred to
  22f-bis. Renumbering twenty-odd comments would have buried an ordering-only
  change in noise.
- **No sibling `backupFormat ===` comparisons exist**; the audit Bug 2 asks for
  turned up only the two lines it names.
- **Regression tests added**:
  `__tests__/unit/lib/backup/mount-index-coercion.test.ts`,
  `__tests__/unit/lib/backup/restore-archive-file-lookup.test.ts`,
  `__tests__/unit/lib/import/quilltap-import-stream-blobs.test.ts`. The last
  was checked against the pre-fix code: five of its seven cases fail there.

Both of Bug 5's open product calls were taken rather than left to omission:

- **Multiple user-controlled characters** — the active speaker wins, as the
  entry suggested. `activeTypingParticipantId` names a *participant* id, not a
  character id, so `operatorCharacterIds` resolves it through the participants
  array and returns an ordered candidate list (active speaker first, then the
  rest in stored order) rather than a set. A **removed** user-controlled
  participant is not a candidate at all — the operator is not playing them any
  more, whatever the roster still resolves through them.
- **A gate the operator's own character fails** — the row is kept and
  **labelled** with the character it will run as, using the `characterLabel`
  the per-variant listing already carries and the dialog already renders as
  *"as Friday"*. Omitting the row would have withheld a working tool over a gate
  that was never asked about the operator; falling through silently was the
  trap. The same label covers the other fallback case, an all-LLM room the
  operator plays nobody in. A one-character room stays unlabelled — there is
  nothing to disambiguate.
- **POST's `asCharacterId`-less fallback takes the same preference.** Strictly
  beyond the reported bug (that path rolls against `{}` by design, so no sheet
  is consulted), but it was the other place "arbitrary" meant "first", and
  leaving the two orderings different would have been a trap of its own. It
  decides only which definition of a shadowed name gets dealt.
- **Regression test added**:
  `__tests__/unit/app/api/v1/chats/custom-tools-perspective.test.ts` (10 cases).
  Checked against the pre-fix code: six of them fail there.

### Known residue from Bug 3's placement

Not a regression; a follow-up.

Immediately after 22a is the right slot, and it is worth writing down *why*,
because two nearby slots are worse:

- **After 22c** (doc-store file rows) the replay's `findOrCreateByContent`
  would match the archived content row by sha and hard-link to it, so 22f's
  `INSERT INTO doc_mount_blobs` would then violate `UNIQUE(fileId)` and the
  archived blob row would be refused.
- **After 22d** the same, plus the replay would have to unique-suffix around
  every archived link.

At 22a the doc-store has mount points and nothing else, so the replay builds an
independent set of file/link/blob rows that cannot collide with the archived
ones. What remains is narrow and warning-shaped:

- Restoring a **second-generation archive** — one taken from an instance that
  was itself restored — replays project-less files into the Quilltap Uploads
  mount at `restored/<name>`, which is exactly where the archived link rows for
  those files already live. The replay gets there first (22a-bis), so 22b's
  archived `restored` folder row and 22d's archived link rows collide with it
  and are logged as warnings. Content is present either way; the archived link
  *ids* are what get lost.
- First-generation archives are unaffected: the archived paths are `chat/`,
  `images/`, etc., and `restored/` is free.
- Project-bound files never collide at all — `projects.create` provisions a
  *fresh* official store and discards the archived `officialMountPointId`, so
  the replay and the archived rows land in different mount points. (That
  duplication predates this fix and is orthogonal to it.)

Fixing this properly means teaching the replay to recognise that the archive
already carries the store rows for a file and skip re-ingesting it, rather than
reshuffling phase order. Out of scope here.

### Owed to the v5 side

The two tripwires named above will now fire. Both are the tripwire working:
retire the divergence entries and let the cases become plain equalities.

| v4 fix | v5 tripwire | Action |
|---|---|---|
| Bugs 1–3 | `crates/quilltap-harness/tests/system_restore_state.rs` → `assert_divergences` | Re-rule the divergence as converged |
| Bug 4 | `crates/quilltap-harness/tests/system_import_equivalence.rs` → `EXPECTED_DIVERGENCES` | Remove the `throw_ndjson_truncated_blob` case |
| Bug 78 | `crates/quilltap-harness/tests/avatar_job_tier3_equivalence.rs` → `legacy_four_key_equipped` | The v4 leg asserts the throw and will now fail by design — retire the pin to a plain equality |
| Bug 79 | `crates/quilltap-harness/tests/…` → the `system_import_state` family | v4 no longer swallows; retire the both-direction pins. v5's per-step skip sentences and v4's `warnings` sentences are worded independently — converge the text only if a 1:1 sentence match is wanted (the v5 list is in that repo's `status-log.md` P4.48 entries) |

The oracle baseline moves once, at the commit that carries these fixes.

**Bug 5 fires no tripwire, which is the point.** v5 reproduces it faithfully, so
nothing over there is asserting a divergence to catch the upstream fix — the two
sides now simply disagree, silently, until the mirror lands. What v5 owes:

- `crates/quilltap-core/src/api/custom_tools.rs` — the `sightings[0]` pick at
  `:293` becomes the operator preference, and the same fallback label; the
  metadata selection at `:418-422` is unchanged.
- `src/tools/run_custom.rs:545` is **not** touched — the rolling character's own
  sheet was always right.
- Finding #30 is re-ruled from "v4-faithful, deliberately not fixed" to fixed
  upstream, and the m6 parity note for the composer popup is updated with it.

**Bug 84 fires no tripwire either**, and for the same reason: v5 reproduces it
faithfully, so nothing over there asserts a divergence. What v5 owes is two
reads:

- `apps/web/src/app/core/chat-stream.reducer.ts:379` — `applyToolResult` stores
  `result: result.result` and drops the sibling `error`; carry it through onto
  the call (or alongside it).
- `screens/salon/salon-conversation.ts:2947` — the `generate_image` failure
  branch reads `(call.result ?? {}).error`; prefer the carried `error`, keep the
  nested read as the fallback, and strip a leading `Error: ` as v4 now does.
- Finding #99 is re-ruled from "v4-faithful, deliberately not fixed" to fixed
  upstream.

---

## Inert dead code

These are dead or unreachable v4 code paths that cost no user anything today —
listed only so the faithful port is not "corrected" toward v4's broken original,
and so a future refactor can remove them. Each is reproduced (or omitted)
faithfully on the v5 side.

- **`roleplayTemplateName`** — set at `SalonView.tsx:140` and read nowhere; the
  only occurrences in the whole checkout are its declaration and four setters.
  Dead state.
- **The `renderedMarkdown`/`renderedHtml` fast path** — no `lib/` writer sets the
  column; the only non-schema references are the maintenance sweep that NULLs it
  and the Zod declarations. Announcements render client-side regardless.
- **`showPerMessageCost`** — unreachable for two independent reasons: the mount
  gate reads `showPerMessageTokens` only, and `MessageActionBar` passes no
  `estimatedCostUSD` (the Message type has no cost field).
- **`showSystemEvents`** — declared, parsed, and defaulted, read by no consumer.
- **`getCheapLLMProvider`'s `if (!cheapLLMSelection)` arm** — unreachable: the
  priority-5 fallback always yields the current profile, and the handler has
  already thrown if that profile is missing.
- **Provider `shouldHideChat`** — dead: zero callers, and it reads the wrong
  field name (`isDangerous` vs the real `isDangerousChat`).
- **The chat-profile `GenerateImageDialog` opener** — `useModalState.ts:63`
  exports `openGenerateImage`, which no v4 component calls; that dialog is
  unreachable (the reachable one is the standalone dialog).
- **The third recall-replay route error arm** — documented dead code.
- **`llmLoggingSettings?.retentionDays ?? 30`** — unreachable: the cell is
  Zod-parsed on read, so a NULL/absent cell arrives as the full default object and
  `retentionDays` is always present.
- **The Anthropic per-message cache arm** — dead in v4.
