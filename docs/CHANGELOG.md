# Quilltap Changelog

## Recent Changes

### 4.9-dev

#### Max Tokens and Top P from the profile are actually sent

A connection profile stores its sampling knobs under the keys the editor writes: `temperature`, `max_tokens`, `top_p`. The Salon's streaming path read `modelParams.maxTokens` and `modelParams.topP` — camelCase names that do not exist in that blob — so two of the three came out `undefined` on every turn and the provider fell back to its own defaults. On Ollama that meant `num_predict: 4096` and `top_p: 1` regardless of what the profile said, and the profile card in Settings displayed figures that were never used.

Regenerate/swipe read the same blob correctly, so the two paths disagreed: the original reply used the provider defaults and a regeneration of that same reply used the profile. The greeting path had the camelCase bug too, on both its normal and its Concierge-uncensored branch.

`resolveSamplingParams` (`lib/llm/sampling-params.ts`) is now the one place that maps a parameters blob to the three `LLMParams` fields — canonical snake_case first, camelCase tolerated for a hand-edited or imported blob, absent knobs left undefined so nothing is invented. The streaming service, regenerate/swipe, the greeting path, and the image-description fallback all go through it. Do not read `parameters.max_tokens` at a call site again.

Not to be confused with `resolveMaxTokens` in `model-context-data.ts`, which deliberately ignores `parameters.max_tokens`: that one sizes the context budget's response reserve, this one is the per-request generation cap on the wire.

Covered by `lib/llm/__tests__/sampling-params.test.ts`. One consequence worth knowing: a profile carrying a large Max Tokens has been ignored until now and will be honoured from here on.

#### Ollama profiles can set their own request timeout

An Ollama turn was bounded by the shared 5-minute default in `@quilltap/plugin-utils` with nothing in the UI to change it. On a streaming call that budget covers only the wait for the first token — but loading a large model off disk and evaluating a long prompt both happen inside that silence. A 27B model on a 20k-token prompt, roused cold on a busy machine, ran 220–295 seconds per turn against a 300-second ceiling; the turn that finally crossed it died with `AbortError: This operation was aborted` and left no assistant message in the chat at all.

The Ollama plugin (1.0.42) gains a **Request Timeout (seconds)** field on the connection profile, stored as `request_timeout_seconds` and applied by `resolveProfileTimeoutMs` to both the streaming first-byte timer and the non-streaming whole-request signal. Blank, absent, or unparseable falls through to 300, so nothing changes for a profile that never touches it. A caller-supplied `LLMParams.requestTimeoutMs` still wins, keeping the cheap-LLM task deadlines a hard ceiling.

#### The context budget honors the profile's Max Context (bug 70)

A profile whose model name isn't in Quilltap's lookup tables — any `hf.co/...` Ollama tag, any custom OpenAI-compatible endpoint — was budgeted at 8192 tokens no matter what Max Context said. Conversation history was trimmed to fit that figure on every turn, silently, and the only signal was a "Conversation is getting long" warning that fires exclusively when history has just been dropped.

The window was resolved two different ways in the same function. `calculateContextBudget` used a model-name lookup (`getModelContextLimit`), which falls through to the 8192 OLLAMA/OPENAI_COMPATIBLE default for an unknown name; `calculateMaxAvailable`, 270 lines later, read `profile.maxContext` and saw the real value. One live turn resolved 8192 and 65536 seconds apart. The small figure won everywhere it did damage: it drove `systemPromptBudget`, `recentMessagesBudget`, and the remaining-budget math that feeds `selectRecentMessages`. Compression, working from the correct number, rightly did nothing — so the logs paired an apparent overage with `compressionApplied: false`, which reads like a compression failure and isn't one. The pre-send validation warning derived its limit from the same corrupt figure, so it confirmed the bad number instead of catching it.

`resolveContextWindow(provider, modelName, profile)` in `lib/llm/model-context-data.ts` is now the single source of truth: the profile's `maxContext` wins, the name lookup is the fallback, and a zero or negative column falls through rather than producing a zero-token budget. `getRecommendedContextAllocation`, `getSafeInputLimit`, and `calculateMaxAvailable` all route through it, `calculateContextBudget` takes the profile, and `buildContext` passes `options.connectionProfile`. `external-prompt-generator.service.ts` had the same blind spot on the character-prompt path and now passes its profile too.

For the reported 65536-token profile the budget goes from 8192 to 65536, the history allowance from roughly 1.5k tokens to 32768, and the spurious warning stops.

Two adjacent gaps in the same accounting were fixed alongside it.

**The builder and the validator now use one ceiling.** The builder filled to `totalLimit − responseReserve` while the pre-send check warned above `totalLimit − responseReserve − 10%`, so a context packed exactly as instructed could be reported as an overage. `computeSafeInputLimit` owns that formula now; `ContextBudget` carries `safeInputLimit` and `safetyMargin`, the builder's `remainingBudget` derives from it, and the orchestrator reads it instead of recomputing.

**The budget now counts the whole payload.** Tool schemas ride alongside the message array and were never counted at all — thousands of tokens on a full roster, and on a small window more than the conversation. Agent-mode instructions and the tool-change notice were spliced in after the budget had been spent. All three are known before the context is built, so new `lib/services/chat-message/turn-extras.ts` builds and measures them in one place: the total is passed to the builder as `reservedOutgoingTokens` and held back from the message budget, the tool schemas are added to the pre-send estimate, and the same strings it built are spliced in rather than reconstructed at the splice site. `countToolSchemaTokens` measures the serialized form, so it works for both provider tool shapes, and returns 0 instead of throwing on a definition that won't serialize.

One consequence: with the reservation subtracted, a large character on a small window can leave no room for history at all. That case now warns by name instead of silently sending a character with no memory of the exchange.

#### Archived characters can be rehydrated again (bug 69)

Rehydrating an archived character failed with "the bundle's decrypted content does not match its recorded digest — the bundle is corrupt". The bundle was fine; its database row was not.

An archive bundle is written encrypted, but its `files` row records the digest of the *decrypted* content — that is the digest that survives a passphrase change and actually verifies the contents. The filesystem watcher knew nothing of that: it re-derives `sha256` and `size` from disk for any file that changes, and it saw the bundle land seconds after the row was created. From then on the row held the digest of the encrypted bytes, and the verification on rehydrate could never pass again. Archiving was effectively one-way. The boot reconciliation had the same hole on its size-mismatch path, which is exactly the case a re-encryption produces.

Which rows may have their digest re-derived from disk is now decided in one place, `lib/file-storage/digest-policy.ts`, and both the watcher and the reconciliation ask it; archive rows keep their digest and still get their size corrected. For bundles already spoiled, rehydration self-heals: if the recorded digest is exactly the digest of the file as stored, the bytes are intact and the row is the damaged part — it is repaired, a warning is reported, and the rehydrate proceeds. Any other mismatch is still refused as corrupt.

Verified live: archive → rehydrate now round-trips cleanly, and a row clobbered by the old code rehydrates with the repair warning.

#### A send from the composer's raw-Markdown view no longer discards the edits (bug 67)

The Salon composer's source toggle swaps a plain `<textarea>` in front of the Lexical editor, which stays mounted but hidden with its sync bridge suspended. The submit path read the editor handle unconditionally, so a message sent from the source view shipped the editor's pre-toggle document and every source edit was silently dropped — no error, and the composer cleared as though the send had worked.

Which surface is authoritative now lives in one place, `app/salon/[id]/composer-source-mode.ts`. `resolveComposerSubmitText` sends the textarea's text while the source view is showing and the editor handle otherwise; `resolveComposerHasContent` gates the Send button on the same visible surface, instead of on a presence flag the suspended editor is no longer updating. Post-send clearing already covered both surfaces.

Two adjacent gaps are unchanged and were not part of this fix: Ctrl/Cmd+Enter does nothing in the source textarea (the keyboard send lives in the hidden editor's plugin, so the Send button is the only send route there), and source-view edits are outside draft persistence, which is fed by the editor.

Covered by `__tests__/unit/app/salon/composer-source-mode.test.ts`.

#### The Archived badge shows on a chat's first load (bug 66)

A chat seating an archived character showed no **Archived** badge in the participant sidebar. Two enrichment paths project the same character, and the character-archive work extended only one: the chat GET that the sidebar renders from goes through `getCharacterDetail`, which never carried `archivedAt`. It now does, on both of its return paths — including the chat-avatar-override return an archived seat with a wardrobe-generated avatar takes — and the enriched type declares the field so it cannot be dropped silently again.

Verifying against a live instance turned up a second link in the same chain: `useParticipants` rebuilds each participant's character field by field for the sidebar card and dropped the tombstone again, so the badge could not light on any path, not just a fresh load. Both projections now carry it. The archived seat took no turns either way; the badge was the only casualty.

#### Multi-character `[Name]` prefill is now a per-profile setting (bug 68)

In a multi-character chat, every reply is anchored to the character whose turn it is by one of two routes: an assistant message prefilled with `[Character Name]` (the model structurally continues only that line; the tag is stripped downstream), or a prose instruction appended to the system prompt. Until now the route was hardcoded by provider — Anthropic got the prose branch because 4.6+ rejects a request ending on an assistant message, and everything else got the prefill.

That was wrong for Ollama. Ollama's `think` support is implemented in the model's chat template, which opens the thinking block at the *start* of the assistant turn — so a prefill means the block is never opened and `message.thinking` comes back empty however the profile's **Enable Thinking** box is set. Reproduced against `localhost:11434` on `hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL`: identical request, no prefill → 470 thinking characters, with prefill → 0. The 8B shows the uglier variant — it reasons anyway, the opening tag is gone, and an orphan `</think>` leaks into the reply (caught by the think-parser's swallowed-tag rule). Other providers are unaffected because their reasoning arrives in a protocol field rather than a template artifact; in one instance's history, DeepSeek carried reasoning on 1742 of 5689 multi-character turns while Ollama managed 0 of 12.

Connection profiles gain a `multiCharacterPrefill` column and an **Announce the speaker in multi-character scenes ([Name] prefill)** checkbox. Migration `add-profile-multi-character-prefill-field-v1` backfills existing rows to preserve today's behaviour exactly: Anthropic profiles off, everything else on. New profiles seed from the provider default, and switching provider on an unsaved profile re-seeds it. The hardcoded Anthropic branch in `context-builder.service.ts` is gone; the anchor is now applied by `applyMultiCharacterTurnAnchor`, and the setting is resolved through the single chokepoint `profileUsesNamePrefill` (`lib/llm/multi-character-prefill.ts`) — never read the column directly, because NULL means "never chosen" (a pre-migration row, or a profile imported from a pre-4.9 bundle) and resolves to the provider default. Ticking the box on an Anthropic profile is allowed but warned about in the editor, since it will 400 on every multi-character turn.

The `finalizeMessageResponse()` truncation at the first foreign speaker tag remains the structural backstop on both routes, and single-character chats use neither.

#### Generated opening greetings keep their reasoning

`generateGreetingMessage` consumed the provider's stream reading `chunk.content` and nothing else, so a thinking model's reasoning while composing a greeting was discarded — one observed greeting cost 3620 characters of reasoning and rendered no thinking fold. The chunk loop now tracks `reasoningContent` (cumulative, so assignment rather than concatenation, matching the Salon's streaming contract), `GreetingResult` and `autoGenerateFirstMessage` carry it through all four generation attempts, and it is persisted onto the greeting message. Display only, like every other stored reasoning.

#### Logs: background-job child debug lines no longer appear as info

The parent process re-emits every log record the forked job child sends it, so all output lands in one `combined.log` with a single writer. That relay only handled `error`, `warn`, and `info`, and sent everything else — `debug` and `trace` — through `log.info`. Since most of the image pipeline, memory extraction, and autonomous turns run in the child, a large share of the file's `"level":"info"` lines were actually debug output, making level-based triage unreliable. The relay now maps `trace` and `debug` to their own levels and re-emits anything unrecognized at debug rather than info. Log volume is unchanged: the child inherits `LOG_LEVEL` through `fork` and already filters before sending.

#### Ollama: Enable Thinking profile option, and `<think>` blocks routed to the thinking display

The Ollama plugin (1.0.41) gains an **Enable Thinking** checkbox in the connection profile's provider options, default off. The setting maps to Ollama's top-level `think` request parameter on both streaming and non-streaming calls: off asks thinking-capable models (Qwen3, DeepSeek-R1, etc.) to answer directly — the clean-output mode you want for JSON-shaped work — and on lets them reason first. Older Ollama servers ignore the unknown field. If a model rejects the parameter outright (some cannot disable thinking), the request is retried once without it instead of failing.

Reasoning now reaches the Salon's thinking fold from both channels Ollama uses. When the server parses the model's template, reasoning arrives on the separate `message.thinking` field, which the plugin previously dropped on the floor; it now streams into `reasoningContent` cumulatively, the same way DeepSeek's does. When the server *can't* parse the template — common with community GGUF imports — the raw `<think>...</think>` block leaks straight into the content stream; a new stateful splitter (`think-parser.ts`) recognizes those blocks even when a tag straddles streaming chunk boundaries, routes their text to the thinking display, and keeps them out of the visible message, the stored content, and tool-call parsing. Responses with no think blocks pass through byte-for-byte. An unterminated block at end-of-stream counts as reasoning.

The splitter also handles the swallowed-opening-tag pattern, live-reproduced against `hf.co/Qwen/Qwen3-8B-GGUF:Q4_K_M`: in no-think mode that model reasons anyway, and Ollama eats the opening `<think>`, so the content arrives as untagged reasoning followed by an orphan `</think>` and then the real answer — which was corrupting cheap-LLM JSON tasks (memory extraction, summarization) pointed at it. A closing tag encountered before any think block and before any visible output now reclassifies everything ahead of it as reasoning, fully cleaning the non-streaming path cheap-LLM tasks use. Once real content has been emitted (or a real think block was seen), a stray closing tag stays in the content; mid-stream, content already emitted before the orphan tag arrives cannot be recalled.

Covered by a new unit suite (`ollama-thinking.test.ts`: parser chop tests at several chunk sizes, native-channel streaming, the retry fallback, non-streaming extraction, the swallowed-open reproduction), and the Ollama schema joins the provider-options snapshot test.

#### Ollama: Max Context now drives the server's context window, and the provider declares tool support

Two follow-ups in the same plugin release (still 1.0.41):

**`num_ctx` from Max Context.** An Ollama server allocates its own default context window (typically 4k–32k) unless the request carries `options.num_ctx` — the Modelfile rarely sets it. Quilltap, meanwhile, budgeted prompts against the profile's Max Context, so a profile set to 262144 against a server loading 32768 meant every long chat was silently middle-truncated by the server with no error anywhere. Verified live: the Qwen3.8-27B GGUF loaded at 32768 despite the model supporting 262144. Now `profileParams()` (`lib/llm/cheap-llm.ts`) injects `num_ctx` from the profile's Max Context for Ollama profiles, and the plugin forwards it on both streaming and non-streaming calls — the window Quilltap budgets against is the window the server actually allocates. An explicit `num_ctx` already in the parameters blob wins; profiles with no Max Context keep the server default, exactly as before. The eight call sites that built `profileParameters` inline from `profile.parameters` (Salon orchestrator, regenerate-swipe, greeting, answer-confirmation, image-description fallback, wardrobe analysis, uncensored extraction, announcer) were converted to the shared helper, so the injection — and any future per-provider parameter — applies uniformly. Note: changing Max Context on an Ollama profile now triggers a model reload on the next call (context size is a load-time property), and Max Context should be sized to fit RAM — the KV cache scales linearly with it.

**Tool capability.** The plugin's `capabilities.toolUse` flips false → true. The provider has long forwarded native tool definitions and normalized `tool_calls`, and modern local models handle them (verified live on both Qwen3 GGUFs, including with thinking enabled). The flag's only effect is the profile editor's default for the *Allow tool use* checkbox on newly created Ollama profiles — it now defaults ticked; the checkbox remains the per-profile gate either way, and existing profiles keep their saved setting.

#### Help search now matches sections, and the Guide's search box now reads the text

Two separate reasons a search of the built-in help came back empty.

**The Guide tab's search box only ever matched titles.** `HelpGuideTab` filtered the topic list on `doc.title.toLowerCase().includes(query)` and never touched the document body — the index shipped to the client carries titles and URLs only. Any term living in the prose ("describe", "uncensored", "timeout") returned nothing at all. Document content is far too large to ship with the index, so the match now runs server-side: `GET /api/v1/help-docs?action=search&q=…` does a case-insensitive substring pass over titles and content and returns matching slugs with a ~180-character snippet centred on the hit. The client debounces at 200 ms, keeps its instant title-only filter for the first keystroke, and shows the snippet under each topic so a body-text match explains itself. Results are tagged with the query that produced them, so a stale response can't leak into a newer query's filter.

**`help_search` scored whole documents.** Help docs were embedded one vector per file. For a 700-line page spanning a dozen subsystems, that single vector is a smear that matches no specific question strongly, and the tool then handed the model the *first* 1000 characters of the file — a table of contents, never the answer. Both halves are fixed:

- A new `help_doc_chunks` table holds section-level slices, rebuilt from disk whenever a doc's content hash changes (migration `create-help-doc-chunks-table-v1`). The slicing reuses the Scriptorium's Markdown-aware chunker at smaller targets (400–700 tokens, 100 overlap); each chunk is embedded with its document title and nearest heading prefixed, so "Uncensored fallback profile" carries the context of the page around it.
- Chunk vectors are written by the same `HELP_DOC` embedding job that writes the whole-document one. That was deliberate: the reindex enqueue, the `embedding_status` bookkeeping, and the dimension reconcile all still count `help_docs` rows, and a chunk can never carry a dimension its parent doesn't. Chunks that already hold a vector are skipped, so a retried job is cheap; a single chunk's failure is logged and skipped rather than failing a job whose main work succeeded.
- `HelpSearch.search` scores every chunk, keeps the best per document, and ranks each document by `max(docScore, bestSectionScore)` — the whole-document score stays in play so a broadly on-topic page isn't buried by an unlucky slicing, and docs with no chunks yet still rank. Results carry a `matchedSection`, and `formatHelpSearchResults` now leads with that section (1500 chars) followed by a shorter document excerpt (600) instead of 1000 characters from the top of the file.
- Section scoring is wrapped so any failure — missing table, unreadable rows — falls back to whole-document scoring with a warning rather than breaking help search.

`help_doc_chunks` joins the embedding sweeps that walk tables by name: `reapply-profile`'s `MAIN_DB_TABLES`, `repair-text-embeddings`' table list, and a full reindex's up-front embedding clear.

Existing instances needed a backfill after all, which runtime verification caught: `ensureHelpDocsSynced` only re-syncs when the *set of paths* on disk diverges from the table, so an upgraded instance has every content hash matching, skips every file, and would have left the chunk table empty forever — section search silently never engaging. `backfillHelpDocChunks` now slices any already-synced document when the chunk table is empty (one count query per boot thereafter, not a scan — chunk rows carry embedding BLOBs) and enqueues the `HELP_DOC` jobs that fill the vectors, since the documents' own embeddings are already present and would otherwise enqueue nothing. Measured on a real instance: 588 chunks across 120 documents, embedded within a minute.

While extracting the shared enqueue helper, `enqueueMissingHelpDocEmbeddings` briefly lost the try/catch around its repository lookup; restored, with its own log line.

#### Docs: rewrote the image-description help, which was wrong on two points and silent on a third

`help/chat-settings.md`'s "Image Description Settings" section described a version of the feature that no longer exists. It called the dropdown "Image Description Provider" (the UI says "Primary image description profile"), it claimed the blank option disabled image descriptions entirely (blank means auto-select, preferring a profile marked Cheap), and it never mentioned the uncensored fallback profile at all — a second dropdown in the same settings card, with real behavior behind it.

The section now covers: what triggers the fallback path (the responding profile's vision checkbox being unticked, not the provider's identity); the reuse chain that skips the vision call entirely for generated images and for uploads that already carry a description; what the auto-select actually picks; the uncensored fallback and the refusal heuristic that invokes it; the `IMAGE_DESCRIPTION` entry in the LLM logs; and the one-minute timeout. The "Image descriptions missing" troubleshooting entry was rewritten to match, and now covers refusals and timeouts rather than only missing configuration.

Also corrected the Cheap LLM section, which listed "Image descriptions" among the operations the cheap profile drives. Image description never consults `cheapLLMSettings` — it only prefers a profile marked Cheap when auto-selecting a describer.

`help/help-chat.md` documents the Guide search box now reading document text rather than titles alone.
