# Plan: Add `reasoning_effort` to the Z.AI (GLM) provider plugin

## Problem

GLM-5.2 burns its output-token budget on excessive thinking. The Z.AI API
(`POST /paas/v4/chat/completions`,
<https://docs.z.ai/api-reference/llm/chat-completion>) exposes a
`reasoning_effort` parameter that controls thinking effort, **but the Z.AI
plugin neither sends it nor lets the user set it.** Every GLM-5.2 call with
thinking enabled therefore runs at the API default of `max` — the most
expensive setting.

### API facts (from the spec)

- `reasoning_effort` is a top-level string parameter on the chat-completions
  request. Enum: `max`, `xhigh`, `high`, `medium`, `low`, `minimal`, `none`.
- It **only takes effect when `thinking` is enabled**.
- It is **only supported by `glm-5.2`.**
- Mapping is coarse and skewed high: `none`/`minimal` → skip thinking;
  `low`/`medium` → mapped up to `high`; `xhigh` → mapped to `max`; default `max`.
- So the genuinely distinct effective levels are: off (`none`/`minimal`),
  `high` (covers low→high), and `max` (covers xhigh→max).

## Decisions (all settled with Charlie — no open questions)

1. **Default to `high`.** When thinking is not explicitly disabled on a gated
   model and the profile has not set an explicit effort, the plugin sends
   `reasoning_effort: 'high'` to dial back from the API's `max` default out of
   the box. This is the behavior that actually fixes the token-burn without
   requiring per-profile config.
2. **Apply the default unless thinking is explicitly disabled.** GLM-5.2 thinks
   compulsorily and the `thinking` field defaults to enabled server-side, so a
   profile left at "(model default)" still thinks — and that is precisely the
   config burning tokens at `max` today. Therefore apply the `high` default
   whenever `body.thinking?.type !== 'disabled'` on a gated model (i.e. NOT
   only when thinking is explicitly `enabled`). Only an explicit "Disabled"
   suppresses it.
3. **Gate by model generation, not an exact id.** `reasoning_effort` is a
   GLM-5.2-and-newer capability. Match **glm-5.2 or higher within the 5.x line,
   and any glm-6+ generation** — i.e. forward it for glm-5.2, glm-5.3, …,
   glm-6, glm-7, etc.; do NOT forward it for glm-5.1, glm-5, glm-5-turbo, or any
   4.x / vision model. This survives Z.AI revisioning the id (e.g.
   `glm-5.2-0626`) or shipping a newer generation without a code change.
4. **Enum breadth: minimal set.** Expose only values that map 1:1 to real
   GLM-5.2 behavior — `(model default)`, `Minimal` (effectively off), `High`,
   `Max` — matching the DeepSeek plugin. Do NOT expose the full seven-value spec
   enum, because low/medium silently fold to high and xhigh folds to max, which
   misleads users.

## Precedent to mirror

The **DeepSeek plugin already does almost exactly this** and is the reference
implementation. See:

- `plugins/dist/qtap-plugin-deepseek/provider.ts`
  - `DEEPSEEK_PROFILE_PARAM_ALLOWLIST` includes `'reasoning_effort'` (line ~40).
  - `applyProfileParameters` forwards it with the empty-string-means-omit
    convention (line ~149).
- `plugins/dist/qtap-plugin-deepseek/index.ts` schema exposes a
  `reasoning_effort` enum field (model default / High / Max) with help text
  "DeepSeek's reasoning scale. low/medium fold to high; xhigh folds to max."
  (visible in the snapshot at
  `__tests__/unit/plugins/__snapshots__/provider-options-schema-snapshot.test.ts.snap`,
  lines ~110–130.)

**Differences from DeepSeek for the Z.AI version:** (a) default is `high` not
empty/omit, and (b) the forward is gated to `model === 'glm-5.2'`. DeepSeek
forwards unconditionally; Z.AI must not.

## Files to change

All under `plugins/dist/qtap-plugin-z-ai/`.

### 1. `provider.ts` — forward the parameter

- **Allowlist** (line ~38): add `'reasoning_effort'` to
  `Z_AI_PROFILE_PARAM_ALLOWLIST`, so it becomes
  `['thinking', 'do_sample', 'reasoning_effort'] as const`.
- **Add a model-generation gate helper.** Add a module-level function that
  returns true for glm-5.2-or-newer and false otherwise. It must accept
  glm-5.2, glm-5.3, …, glm-6, glm-7, and revisioned ids like `glm-5.2-0626`,
  and reject glm-5.1, glm-5, glm-5-turbo, glm-4.x, and vision ids. Parse the
  numeric generation out of the id rather than string-matching a fixed value.
  Reference implementation:

  ```ts
  // reasoning_effort is a GLM-5.2-and-newer capability. Parse the
  // major[.minor] generation from the model id and compare against 5.2.
  // Accepts glm-5.2, glm-5.3, glm-6, glm-5.2-0626, etc.; rejects glm-5.1,
  // glm-5, glm-5-turbo, glm-4.x, and the glm-Nv vision family.
  function supportsReasoningEffort(model: string): boolean {
    const m = /^glm-(\d+)(?:\.(\d+))?/i.exec(model.trim().toLowerCase());
    if (!m) return false;
    // Exclude the vision family (e.g. glm-5v-turbo): a 'v' immediately
    // follows the major number with no decimal point.
    if (/^glm-\d+v/i.test(model.trim())) return false;
    const major = Number(m[1]);
    const minor = m[2] !== undefined ? Number(m[2]) : 0;
    if (major > 5) return true;          // glm-6+, glm-7, …
    if (major < 5) return false;         // glm-4.x and below
    return minor >= 2;                   // glm-5.2, glm-5.3, … (not 5.1, 5, 5-turbo)
  }
  ```

  Note `glm-5-turbo` → major 5, minor 0 → false (correct). `glm-5v-turbo` is
  caught by the explicit vision guard. Add a couple of unit-test rows covering
  these edges (see Verification).
- **`applyProfileParameters`** (line ~198): currently iterates the allowlist
  and forwards verbatim (with the `thinking` string→`{type}` normalization and
  the empty-string skip). Two changes:
  - **Gate `reasoning_effort`.** Inside the loop, when
    `key === 'reasoning_effort'`, only set it if
    `supportsReasoningEffort(params.model)` is true. Otherwise skip (do not
    forward to unsupported models).
  - **Default to `high`.** After the allowlist loop, add a fallback: if
    `supportsReasoningEffort(params.model)` **and** thinking is not explicitly
    disabled **and** `body.reasoning_effort` is still unset, set
    `body.reasoning_effort = 'high'`. "Not explicitly disabled" means
    `(body.thinking as { type?: string })?.type !== 'disabled'` — note the
    `thinking` string→`{type}` normalization runs inside the loop, so read
    `body.thinking` *after* the loop, mirroring how DeepSeek's
    `isThinkingEnabled(body)` reads the normalized shape
    (`plugins/dist/qtap-plugin-deepseek/provider.ts` line ~51). Document in a
    code comment that GLM-5.2 thinks compulsorily by default, so the default
    `high` deliberately applies to the "(model default)" thinking case — that
    is the config the change is meant to fix.
- Both `sendMessage` (line ~283) and `streamMessage` (line ~386) already call
  `this.applyProfileParameters(body, params)`, so putting the logic there
  covers both paths — **no separate edits to the two body builders needed.**

### 2. `index.ts` — expose the profile-editor field

- In `optionsSchema` (line ~111), add a second field to the existing
  "Z.AI Options" group, after `thinking`, mirroring the DeepSeek
  `reasoning_effort` field but with the glm-5.2 / default-high framing:
  - `key: 'reasoning_effort'`
  - `label: 'Reasoning Effort'`
  - `type: 'enum'`
  - `default: ''` (so existing/blank profiles fall through to the provider's
    glm-5.2 `high` default rather than being pinned in the UI). **Note the
    asymmetry:** the *stored* default is empty, but the *effective* default
    on glm-5.2 is `high`, applied in the provider. State this in the field's
    `helpText` so it isn't surprising.
  - `enumValues` (minimal set — decided): `(model default)` = `''`,
    `Minimal` = `'minimal'` (effectively off), `High` = `'high'`,
    `Max` = `'max'`. Do not expose the full seven-value spec enum.
  - `helpText`: explain it only applies to **glm-5.2** with thinking on; that
    low/medium fold to high and xhigh folds to max; and that leaving it at
    "(model default)" uses `high` on glm-5.2 (chosen to avoid the API's
    expensive `max` default). Steampunk-Wodehouse voice per CLAUDE.md
    user-facing writing rule.
- Update the group's comment block (line ~102) to mention `reasoning_effort`.

### 3. `package.json` + `manifest.json` — version bump

- This is a **plugin change**, so per CLAUDE.md "Hard stops": bump the patch
  version in **both** `package.json` (`1.1.13` → `1.1.14`) and
  `manifest.json` (`version: "1.1.13"` → `"1.1.14"`), then re-run
  `npm run build:plugins` before staging. (Plugin bumps do NOT require a manual
  `npm publish` — that hard-stop is only for `packages/`.)

### 4. Rebuild the bundle

- Run `npm run build:plugins` from the repo root. This regenerates
  `plugins/dist/qtap-plugin-z-ai/index.js` from the `.ts` sources. Do not
  hand-edit `index.js`.

### 5. `README.md` (plugin) — document the option

- Add a short "Reasoning effort" subsection (near the model tables / web-search
  section) noting the new profile option, that it is glm-5.2-only, and the
  default-`high` behavior.

### 6. Help docs — REQUIRED by CLAUDE.md

- CLAUDE.md: "All user-visible changes MUST be documented in `help/*.md`."
  The connection-profile options surface in the profile editor, so update the
  relevant help file. Candidates to check:
  `help/connection-profiles.md` and `help/thinking-display.md` (both already
  reference GLM — confirmed via grep). Add the `reasoning_effort` option to
  whichever documents provider profile options. Ensure the `url` frontmatter
  and the `help_navigate(url: "...")` call in the "In-Chat Navigation" section
  match (CLAUDE.md requirement).

### 7. `docs/CHANGELOG.md` — REQUIRED before commit

- Add a reverse-chronological entry in **plain American English** (the
  changelog is the explicit exception to the steampunk voice). Something like:
  "Z.AI plugin: added a Reasoning Effort connection-profile option; GLM-5.2
  now defaults to `high` effort (was the API default `max`) to curb runaway
  thinking-token usage."

### 8. Snapshot test — likely no change, but verify

- The provider-options-schema snapshot test
  (`__tests__/unit/plugins/provider-options-schema-snapshot.test.ts`)
  currently covers only Anthropic, OpenAI, OpenRouter, DeepSeek — **Z.AI is not
  in it.** So adding the field won't break an existing snapshot.
- **Add a Z.AI case to that test** (decided — do it): require
  `qtap-plugin-z-ai/index.js`, assert `getProviderOptionsSchema()` matches a
  snapshot so the new schema is locked against future drift, then run
  `npx jest -u __tests__/unit/plugins/provider-options-schema-snapshot.test.ts`.
  This brings Z.AI to parity with the other providers in the suite.

## Verification

1. `npx tsc` (NOT `npm run build` — per CLAUDE.md) — must be clean.
2. `npm run build:plugins` — succeeds and regenerates the Z.AI `index.js`.
3. If the snapshot test was extended (step 8): run it and review the diff.
4. **Unit tests (do these — they encode all the decisions):**
   - `supportsReasoningEffort` truth table: `glm-5.2` → true, `glm-5.2-0626`
     → true, `glm-5.3` → true, `glm-6` → true, `glm-5.1` → false,
     `glm-5` → false, `glm-5-turbo` → false, `glm-4.6` → false,
     `glm-5v-turbo` → false.
   - `applyProfileParameters` behavior: a glm-5.2 call with thinking not
     disabled and no explicit effort sets `body.reasoning_effort === 'high'`;
     the same call with Thinking Mode = Disabled sets **no** effort; a glm-4.6
     call never sets effort; an explicit profile value of `'max'` overrides the
     default to `'max'` on glm-5.2.
5. Confirm `finish_reason` behavior: combining lower effort with a sane
   `max_tokens` is the robust fix — note in the changelog/help that effort
   alone doesn't hard-cap tokens (reasoning still counts against `max_tokens`,
   and hitting the ceiling yields `finish_reason: "length"` /
   `model_context_window_exceeded`).

## Open questions

None — all design decisions are settled above (see "Decisions"). This plan is
ready to execute as written.
