# Feature: Per-Model Image Options + LoRA Support (NanoGPT first, generic by design)

**Status:** Implemented (v4.9-dev, 2026-08-29). Phases 1-5 landed; Phase 6
(dogfood proofs against a real NanoGPT key) is the one outstanding item — the
live probe of the flat-key passthrough has not been run, and the plugin's
request logger names every `lora_*` key it posts precisely so that run is
readable.
**Written:** 2026-08-29
**Provenance:** Research pass over NanoGPT's Image API docs, live model catalog, and
the NanoGPT web client's own per-model settings tables; codebase survey of the
Lantern image pipeline, the NanoGPT plugin, and the schema-driven provider-options
machinery.

## Summary

Give image profiles the same schema-driven per-model options the LLM connection
profiles already have, and add first-class LoRA support: a canonical
`loras: [{ source, scale }]` list stored on the image profile, edited in a dedicated
UI, and translated to each provider's wire dialect *by the plugin*. NanoGPT is the
first consumer (it hosts ~20 LoRA-capable image models today); the design is
deliberately provider-generic so ComfyUI (see
[comfy_ui_local_image.md](./comfy_ui_local_image.md)), fal-style providers, and
future OpenAI-compatible image endpoints plug into the same seam.

## Research findings: how NanoGPT does LoRAs

### The wire dialects (verified from NanoGPT's own client settings tables)

NanoGPT's generation endpoints accept **flat, model-specific body keys** alongside
the common fields (`model`, `prompt`, `n`, `size`, …). The docs already document
`guidance_scale`, `num_inference_steps`, `strength`, and `seed` this way on
`POST /v1/images/generations` ("model-specific generation controls"). The LoRA
fields are the same passthrough class. Three dialects exist across NanoGPT's
LoRA-capable models:

| Dialect | Wire keys | Max LoRAs | Model families (by id) |
|---|---|---|---|
| **Indexed pairs** | `lora_url_1`/`lora_scale_1` … `lora_url_N`/`lora_scale_N` | 4: `flux-2-dev-lora`, `flux-2-dev-lora-image-to-image`. 3: the rest | `flux-2-dev-lora*`, `flux-2-klein-4b`, `flux-2-klein-9b`, `wavespeed-ai/flux-2-klein-base-{4b,9b}/{text-to-image,edit}-lora`, `z-image-turbo-lora`, `wavespeed-ai/krea-v2/turbo-lora` |
| **Single weights** | `lora_weights` (URL), `lora_scale`, optional `hf_api_token` (private/gated weights) | 1 | `pruna-ai/p-image/text-to-image-lora`, `pruna-ai/p-image/edit-lora` |
| **Single URL + strength** | `lora_url`, `lora_strength`, optional `lora_preset` | 1 | `flux-lora`, `flux-lora/inpainting` |

Details that matter:

- **URL values**: a `.safetensors` URL or a HuggingFace `owner/model-name`
  reference. NanoGPT's own hint text: "Path to the first LoRA model (e.g.,
  owner/model-name or .safetensors URL)."
- **Scale ranges**: wavespeed-family `lora_scale_N` is 0.0–4.0, default 1, step
  0.1. fal-family `lora_strength` is 0.1–4.0, default 1. pruna `lora_scale`
  defaults 0.5 (text-to-image) / 1 (edit).
- **`custom-civitai`** (runware engine) does LoRAs through CivitAI AIR
  identifiers baked into model selection, not through these keys — **out of
  scope** for this feature (follow-up candidate).

### Discovery metadata

- `GET /api/v1/image-models?detailed=true` (the endpoint the plugin already
  calls) returns per-model `tags` — **LoRA-capable models carry `"lora"` in
  `tags`** — plus `supported_parameters.resolutions`, `max_images`, and
  `capabilities.nsfw`.
- Neither the legacy listing nor the newer
  `GET /api/v1/images/models/{id}/endpoints` metadata advertises the LoRA
  request keys (`allowed_passthrough_parameters` is `[]` today). So **the
  dialect table above cannot be discovered; it must live in the plugin** as a
  static family map. The `lora` tag is still useful as the *capability* signal
  for models the static map doesn't know.

### Verification caveat (build this into the work)

The flat-key passthrough is proven for `guidance_scale`/`num_inference_steps`
(documented) and strongly evidenced for the `lora_*` keys (NanoGPT's own web
client sends them; the model pages render them as public generation settings).
It is **not** documented for the OpenAI-compatible endpoint the plugin uses via
the `openai` SDK. First implementation step on the plugin: a cheap live probe —
generate on `flux-lora` with a known-good public LoRA URL at scale 4 vs. no
LoRA, and once with a garbage LoRA URL (a processed-but-invalid URL fails
loudly; a silently-dropped key does not). If the legacy endpoint drops the
keys, fall back to raw `fetch` against the normalized `POST /api/v1/images`
route for LoRA-carrying requests only.

## Current state (the gaps this feature closes)

1. **`ImageGenParams` is a closed field list**
   (`packages/plugin-types/src/providers/image.ts`): `prompt, negativePrompt,
   model, size, aspectRatio, orientation, quality, style, n, responseFormat,
   seed, guidanceScale, steps`. No open-ended bag — unknown profile parameters
   can never reach a plugin.
2. **`mergeParameters` drops unknown keys**
   (`lib/tools/handlers/image-generation-handler.ts:246`), and the two
   background-job handlers (`character-avatar.ts:238`,
   `story-background.ts:637`) read only `parameters?.quality`. Four call sites
   build params independently (plus `app/api/v1/images/route.ts` and the
   wardrobe preview route).
3. **The image-profile options UI is a hand-written switch**
   (`components/image-profiles/ImageProfileParameters.tsx`) with hardcoded size
   lists per provider — exactly what the LLM side retired when
   `ProviderOptionsSchema` + `ProviderOptionsPanel` landed.
4. **The reserved seams for this feature already exist** in
   `packages/plugin-types/src/plugins/provider-options.ts`:
   `ProviderOptionField.appliesToModels` ("reserved for the model-keyed gating
   follow-up") and `ProviderOptionsSchemaContext.modelName` ("the seam reserved
   for a follow-up that will gate fields per model"). This feature is that
   follow-up, applied to images.
5. **Prior LoRA art**: `ImageStyleInfo` (`plugins/provider.ts:329`) already has
   `loraId` + `triggerPhrase`; the trigger-phrase half is plumbed end-to-end
   into prompt expansion (`image-generation-handler.ts:816-830`). Nothing
   consumes `loraId`. The ComfyUI proposal doc sketches `loras` as a repeating
   `{ name, weight }` list — requirements, not an interface (its
   `ImageGenPlugin`/`profileFields` vocabulary predates the real plugin API).
6. **The model-matching primitive exists**: the longest-prefix `matchModel` in
   `lib/image-gen/orientation.ts:67-81`, already used for per-model orientation
   support.

## Design

### 1. Canonical LoRA shape (provider-neutral, the single source of truth)

```ts
// packages/plugin-types/src/providers/image.ts
export interface ImageLoraSpec {
  /** URL to weights (.safetensors), an owner/repo reference, or a
   *  provider-scoped identifier — the plugin decides what it accepts. */
  source: string;
  /** Strength/scale. Omitted = provider default. */
  scale?: number;
  /** Optional trigger phrase injected into the prompt when this LoRA rides
   *  a request (reuses the existing styleTriggerPhrase plumbing). */
  triggerPhrase?: string;
  /** Display label for the UI; never sent on the wire. */
  label?: string;
}
```

Stored in the existing `image_profiles.parameters` JSON bag under the reserved
key `loras: ImageLoraSpec[]`. No migration, no DDL change; `parameters` already
round-trips through `.qtap` export/import and backups as an opaque bag.

### 2. Capability declaration (how the host knows LoRAs apply)

```ts
export interface ImageLoraSupport {
  maxLoras: number;
  scale?: { min: number; max: number; default: number; step?: number };
  /** What the plugin accepts in ImageLoraSpec.source. */
  sourceKinds: Array<'url' | 'hf-repo' | 'provider-id'>;
  /** Optional extra auth field (NanoGPT pruna family's hf_api_token). */
  supportsPrivateWeightsToken?: boolean;
}
```

- Per-model: new optional `loraSupport?: ImageLoraSupport` on the per-model
  info returned by `getImageGenerationModels()`.
- Provider-level fallback: `ImageProviderConstraints.loraSupport?`.
- Resolution mirrors orientation: exact id → longest-prefix family match →
  provider constraint → none (UI hides the LoRA editor; params builder strips
  `loras`).

**A plugin that declares no `loraSupport` never sees a `loras` key.** That is
the genericity guarantee: OpenAI/Google/Grok plugins change zero lines.

### 3. Open params channel

- `ImageGenParams.loras?: ImageLoraSpec[]` — the canonical list.
- `ImageGenParams.profileParameters?: Record<string, unknown>` — mirror of
  `LLMParams.profileParameters`, so schema-driven per-model options
  (`num_inference_steps`, `guidance_scale`, `lora_preset`, `hf_api_token`, …)
  reach the plugin without the host enumerating them. The plugin — not the
  host — decides which keys hit the wire (allow-list per model family, exactly
  the OAC applier precedent from the LLM side).

### 4. Plugin-side dialect mapping (NanoGPT)

`plugins/dist/qtap-plugin-nanogpt/image-provider.ts` gains a small static
family table (longest-prefix keys, mirroring the table in Research above) and a
`applyLoras(requestBody, model, loras)` step:

- indexed family → `lora_url_{i+1}` / `lora_scale_{i+1}`, capped at
  `maxLoras`, extras dropped **with a warn log naming the dropped sources**
  (the finding-#103 lesson: never drop silently);
- pruna family → `loras[0]` → `lora_weights` + `lora_scale` (+
  `hf_api_token` from `profileParameters`);
- fal family → `loras[0]` → `lora_url` + `lora_strength`.

The same body-assembly step forwards the allow-listed `profileParameters` keys
(`num_inference_steps`, `guidance_scale`, `steps`, `strength`, `lora_preset`,
`hf_api_token`) for models that support them. Extra keys ride the OpenAI SDK
call as extra body params (the existing `seed` cast pattern).

### 5. Schema-driven image options panel (retire the hand-written switch)

- New optional plugin hook, sibling to `getProviderOptionsSchema`:

  ```ts
  getImageProviderOptionsSchema?(
    context?: { modelName?: string }
  ): ProviderOptionsSchema | null;
  ```

  Same `ProviderOptionsSchema` type, same renderer. NanoGPT's implementation
  builds the schema **dynamically per model** from its cached
  `/api/v1/image-models?detailed=true` catalog: `size` becomes an `enum` field
  from `supported_parameters.resolutions` (same storage key as today, so
  existing profiles keep working), `n` bounds from `max_images`, plus the
  static per-family extras (steps/guidance for `flux-lora`, etc.). LoRA
  URL/scale fields are **not** options-schema fields — they get the dedicated
  editor (below), because they are a structured repeating pair, not flat keys.
- Serve it from `app/api/v1/image-profiles/route.ts` as
  `GET ?action=options-schema&provider=X&model=Y` (model optional), the same
  try/catch-wrapped pattern as `app/api/v1/providers/route.ts:31-52`.
- `ImageProfileForm.tsx` renders it with the **existing**
  `ProviderOptionsPanel` (it already takes `schema`, `parameters`,
  `modelName`, `onSetParameter` and contains nothing LLM-specific).
  `ImageProfileParameters.tsx` shrinks to: providers with a schema use the
  panel; the legacy switch remains only for providers without the hook until
  their plugins adopt it (OpenAI/Google can migrate opportunistically —
  Z.AI/NanoGPT's `SizeOnlyParameters` panels are subsumed immediately).
- While in there, implement `appliesToModels` gating in `ProviderOptionsPanel`
  using the `matchModel` longest-prefix matcher — it benefits the LLM side too
  and both seams are documented as reserved for exactly this.

### 6. LoRA editor UI

New `components/image-profiles/LoraListEditor.tsx`, shown in
`ImageProfileForm` only when the selected model resolves `loraSupport`:

- rows of (source text input, scale slider using `loraSupport.scale` bounds,
  optional trigger-phrase input, remove button); Add button disabled at
  `maxLoras`, with a count caption ("2 of 3");
- values persist to `parameters.loras` (canonical shape) via the same
  `setParameter` path;
- an over-cap state (profile saved against a 4-LoRA model, then switched to a
  1-LoRA model) renders the extra rows flagged, not deleted — switching back
  loses nothing (model switch deliberately does not reset `parameters`;
  provider switch already does).
- Use existing `qt-*` utilities; if any new `qt-*` class is needed, the
  theme-storybook mirror + publish gate applies (see checklist).

### 7. One params builder (fix the four-way drift)

New `lib/image-gen/params-builder.ts`:

```ts
buildImageGenParams(opts: {
  profile: ImageProfile;
  overrides?: Partial<ImageGenParams>;   // tool input / route body
  orientation?: Orientation;
}): ImageGenParams
```

- merges overrides over `profile.parameters` defaults (today's
  `mergeParameters` semantics, kept byte-compatible for existing fields);
- attaches `loras` (validated + capped via resolved `loraSupport`) and
  `profileParameters` (the residual bag minus host-owned keys);
- injects LoRA `triggerPhrase`s through the existing
  `styleTriggerPhrase`/prompt-expansion seam (multiple phrases join with
  `", "`, applied before expansion so the crafter sees them);
- adopted by all call sites: `image-generation-handler.ts` (both the main call
  and the Concierge reroute), `character-avatar.ts`, `story-background.ts`,
  `app/api/v1/images/route.ts`, `app/api/v1/wardrobe/preview-avatar/route.ts`.
  Without this, LoRAs work in chat and silently vanish for avatars and story
  backgrounds.

### 8. Validation

- Extend the image-profile POST/PUT handlers: when `parameters.loras` is
  present it must parse as `z.array(ImageLoraSpecSchema)` (new Zod schema in
  `lib/schemas/profile.types.ts`, exported next to `ImageProfileSchema`) —
  otherwise 400 `validationError`, nothing written (the P4.55/P4.D120
  guard-order lesson: validate before write, never silently keep).
- `source` must be non-empty; `scale` finite and within a permissive global
  bound (0–10) — per-model bounds are UI + plugin concerns, not storage
  concerns (a profile may be edited before a model is chosen).

## What this does NOT change

- No DB schema/DDL change (the `parameters` bag absorbs everything). No
  migration.
- No change to `generate_image`'s tool input schema — the LLM does not pass
  LoRA URLs; LoRAs are profile-level config (a per-character LoRA association
  is a named follow-up, below). Therefore no tool-snapshot churn.
- Existing profiles: untouched keys keep their meaning (`size`, `quality`,
  `seed` all keep the same storage keys under the schema-driven panel).

## Implementation plan (phased; each phase lands green)

### Phase 1 — plugin-types (⚠ publish gate)

`packages/plugin-types/src/providers/image.ts` + `plugins/provider.ts`:
`ImageLoraSpec`, `ImageLoraSupport`, `ImageGenParams.loras`,
`ImageGenParams.profileParameters`, `loraSupport` on the per-model info and
`ImageProviderConstraints`, `getImageProviderOptionsSchema` hook. Bump the
package version, then **stop and ask the human to `npm publish` before
installing** (standing rule; the publish gates the commit).

### Phase 2 — host seams

1. `ImageLoraSpecSchema` in `lib/schemas/profile.types.ts`; wire into the
   image-profiles POST/PUT validation.
2. `lib/image-gen/lora-support.ts`: `resolveLoraSupport(provider, model)`
   (exact → prefix → provider constraint), reusing/exporting `matchModel`.
3. `lib/image-gen/params-builder.ts` (§7) + adopt at all call sites; debug
   logs on every path (what loras resolved, what was capped/stripped).
4. `?action=options-schema` on `app/api/v1/image-profiles/route.ts`.
5. Unit tests: builder merge semantics (existing behavior pinned first),
   lora capping, trigger-phrase injection, validation 400s.

### Phase 3 — NanoGPT plugin

1. Static dialect/family table + `applyLoras` + `profileParameters`
   allow-list in `image-provider.ts`; `loraSupport` entries surfaced through
   `getImageGenerationModels()` (static families) and the `lora` tag from the
   live catalog for unknown models (capability only, indexed-dialect assumed
   only for known families — unknown LoRA-tagged models get capability
   **without** wire mapping and log a "family unknown" warn rather than guess).
2. `getImageProviderOptionsSchema` built from the cached detailed catalog
   (sizes, n, per-family extras). Cache the catalog fetch (TTL ~1h) so the
   settings UI doesn't hammer the endpoint.
3. **Live probe** (the caveat in Research): verify flat-key passthrough on the
   OpenAI-compatible route; if dropped, switch LoRA-carrying requests to raw
   `fetch` on `POST /api/v1/images`.
4. Unit tests: dialect mapping per family (indexed 3 vs 4, pruna, fal),
   cap-and-warn, no-`loraSupport` strip.
5. Bump plugin patch version (`package.json` + `manifest.json` if needed),
   `npm run build:plugins` (typechecks each plugin) before staging.

### Phase 4 — UI

1. `ProviderOptionsPanel` gains `appliesToModels` (prefix matcher) — shared
   with the LLM side.
2. `ImageProfileForm`: fetch options schema (provider+model keyed, refetch on
   model change), render `ProviderOptionsPanel`; `SizeOnlyParameters` retired
   for providers with a schema.
3. `LoraListEditor` (§6), gated on resolved `loraSupport` (the list-models
   response should carry the resolved `loraSupport` per model so the client
   doesn't duplicate resolution — extend `handleListModels`'s payload).
4. E2E beat: create a NanoGPT image profile against a seeded model list, add
   two LoRAs, save, reload, assert persistence and the cap behavior. (Fixture
   only — no live generation in the suite.)

### Phase 5 — docs + polish

- `help/*.md`: user-facing doc for image LoRAs + per-model options (steampunk
  voice; `url` frontmatter + In-Chat Navigation section matching it).
- `docs/CHANGELOG.md` (plain voice).
- Consider `qtap-export.schema.json`: `parameters` is already an open bag in
  the image-profile export shape — confirm, and add `loras` to any documented
  examples if the schema enumerates keys.
- Update [update-documentation](/.claude/commands/update-documentation.md)
  targets if any listed doc is touched.

### Phase 6 — dogfood proofs (real key, cheap models)

- `flux-lora` (~$0.035) with a public LoRA at scale 4 vs 0 — visible style
  delta proves the wire.
- `z-image-turbo-lora` (~$0.017) with 2 LoRAs — indexed dialect.
- A `generate_image` chat turn AND a story-background job on a LoRA-bearing
  profile — proves the shared builder reached the job handlers.
- The options panel on a real model list (sizes populated from the catalog).

## Implementation notes (as landed)

Where it deviates from, or sharpens, the plan above:

- **Trigger phrases are appended by inspection, not by a flag.** §7 proposed
  injecting phrases before expansion and letting the crafter carry them. That
  is still what happens — `classifyAndRouteForDangerousContent` folds them into
  `styleOptions.styleTriggerPhrase`, resolved against the profile that will
  actually generate (post-reroute) — but the builder then appends only the
  phrases the final prompt does *not* already contain. Threading a
  "did the crafter get them?" boolean through five call sites would have been
  wrong on the two paths where crafting is skipped (no placeholders) or falls
  back to plain substitution.
- **`hf_api_token` and `lora_preset` are not on the general passthrough
  allow-list.** The token is a credential; broadcasting it to whatever model a
  profile happens to name is not something an allow-list should permit. Both
  are attached inside `applyLoras`, where the dialect — and therefore the need
  — is known.
- **`ImageGenerationModelInfo` entries for the LoRA families are generated from
  the dialect table**, not hand-listed beside it. The table already owns which
  families take adapters and how many; a second copy would drift on the first
  cap change.
- **`matchModel` is exported from `orientation.ts`** rather than moved: LoRA
  support resolves exactly the way orientation does, and one matcher serving
  two capabilities is the point.
- **The E2E beat runs through the HTTP API**, not the profile modal. The form's
  model picker is populated from a live provider fetch and the suite
  provisions no NanoGPT key, so a UI-driven beat would assert against an empty
  picker. Everything the feature promises — canonical shape survives the round
  trip, malformed lists refused before any write, resolved cap matches the
  model — lives server-side.
- **Adopting the shared builder changed four call sites' behaviour on purpose.**
  Avatars, story backgrounds, `POST /api/v1/images` and the wardrobe preview
  now honour the profile's `negativePrompt`, `seed`, `guidanceScale` and
  `steps`, which they previously ignored; the wardrobe preview resolves
  portrait through the provider's own mechanism instead of a hardcoded
  `1024x1792` that only OpenAI ever accepted. That is the drift the phase set
  out to fix.

## Generalizing to other LoRA-capable providers

- **The canonical shape is the contract.** `loras: [{source, scale}]` maps
  1:1 onto fal's native `loras: [{path, scale}]` array, Replicate's
  `lora_weights`-style single fields, runware's AIR-referenced adapters, and
  ComfyUI's `LoraLoader` node chain. Each future plugin implements only:
  declare `loraSupport` (per model or provider-wide) + map the canonical list
  in its request builder. Nothing else in the host changes.
- **ComfyUI** (the existing proposal): its `listLoras()` idea becomes an
  optional future hook (`listImageLoras?(): Promise<{id, label}[]>`) that the
  `LoraListEditor` can use to offer a picker instead of a bare URL field —
  additive, not required for this feature. Its `{name, weight}` request shape
  is exactly `{source, scale}`.
- **OpenAI-compatible image endpoints** (SD-WebUI/Forge, LocalAI): most accept
  fal-ish `loras` arrays or `<lora:name:weight>` prompt tags; a plugin can
  even implement `loraSupport` purely as prompt-tag injection — the
  `triggerPhrase` field plus a `source`-to-tag mapping covers it without any
  new seam.
- **`ImageStyleInfo` unification (follow-up):** provider-curated named styles
  (`loraId` + `triggerPhrase`) can be re-expressed as preset `ImageLoraSpec`s
  offered by the plugin, collapsing two half-features into one. Not in scope;
  the trigger-phrase plumbing is shared already.

## Follow-ups (named, not in scope)

1. **Per-character LoRAs** — `ImageLoraSpec[]` on the character, merged
   `[...profile.loras, ...character.loras]` at build time (the ComfyUI doc's
   requirement); needs a cap/priority rule and UI on the character editor.
2. **`custom-civitai`** — AIR-identifier flow (browse/verify CivitAI routes);
   different enough to be its own feature.
3. **LoRA presets** — surface NanoGPT's `lora_preset` values for `flux-lora`
   once there's a discovery source for them.
4. **v5 port note** — this lands on ported surfaces (image profiles, provider
   plugins, options panel). Keep the change well-shaped for the differential
   port: Zod-validated edges, fixed error sentences, the builder as one
   testable unit. The v5 drift catch-up will absorb it as a normal lane.

## Standing-rules checklist (for the implementing session)

- [ ] `packages/plugin-types` version bump → **human `npm publish` before
      install** (hard stop).
- [ ] NanoGPT plugin patch bump + `npm run build:plugins` before staging.
- [ ] All user-visible changes documented in `help/*.md` (with `url`
      frontmatter + In-Chat Navigation).
- [ ] `docs/CHANGELOG.md` entry (plain voice).
- [ ] Any new `qt-*` class → hand-written state variants in
      `_utilities.css` + theme-storybook mirror + package publish gate.
- [ ] Debug logging on every touched backend path.
- [ ] `npx tsc` (not `npm run build`) for type checks; lint runs the spelling
      sweep and the qt-class gate.
- [ ] No stubs/TODOs; validation before writes; nothing dropped silently
      (cap/strip always warns with names).
