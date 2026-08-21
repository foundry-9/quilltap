# Bug 86 — the DeepSeek plugin cannot tell when it is thinking

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-08-21, while fixing [bug 85](fixed/bug-85-deepseek-thinking-prefill-400.md) — recorded there under "Worth folding in" and split out so the fixed entry does not become the home of an unfixed defect |
| **Severity** | Low — nothing errors. Params DeepSeek ignores are sent anyway, and the plugin's README misdescribes which models reason |
| **Who it bites** | anyone on a DeepSeek profile using a V4 model with `thinking` left at `(model default)`, which is the default state. The wasted params are silently discarded by DeepSeek, so the only visible symptom is the README sending users to `deepseek-v4-pro` for a feature `deepseek-v4-flash` already has |
| **Provenance** | v4's own; found while fixing bug 85 |
| **Symptom** | `stripThinkingIncompatibleParams` never runs on a profile that reasons by default, so `temperature`, `top_p`, `frequency_penalty`, and `presence_penalty` go out on a request whose thinking mode ignores them. Separately, the plugin README tells the reader thinking mode is a `deepseek-v4-pro` feature reached through profile parameters |
| **Defect site** | `plugins/dist/qtap-plugin-deepseek/provider.ts:51-58` (`isThinkingEnabled`) and the plugin's `README.md` |
| **v5 status** | Not investigated — v5's DeepSeek path was not examined for this |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

`isThinkingEnabled(body)` decides whether the outgoing request is a thinking
request by inspecting the body it is about to send:

```ts
function isThinkingEnabled(body: Record<string, unknown>): boolean {
  const thinking = body.thinking;
  return (
    typeof thinking === 'object' &&
    thinking !== null &&
    (thinking as { type?: string }).type === 'enabled'
  );
}
```

A profile with `parameters: '{}'` sends no `thinking` key at all, so the
predicate returns `false` — and yet the reply comes back with
`reasoning_content` (observed at length 4111 on `deepseek-v4-flash` during bug
85's verification). The V4 models reason unasked. The predicate is asking what
*we requested*; the question that matters is what the *model will do*.

The consequence is confined: `stripThinkingIncompatibleParams` is skipped, so
`temperature`, `top_p`, `frequency_penalty`, and `presence_penalty` are sent on
a request that ignores them. DeepSeek discards them rather than erroring, which
is why this is a tidiness defect and not an outage.

The README compounds the confusion by documenting thinking mode as a
`deepseek-v4-pro` feature reached through profile parameters, which is the
belief that produced the predicate.

## Root cause

Both come of the same missing fact: until bug 85 there was nowhere to record
that a *model* reasons without being asked. `models.ts` now carries
`thinksByDefault` on both V4 entries and the plugin declares a
`thinkingTurnRule`, so the fact exists — the provider just doesn't consult it.

## Why it survived

- **Nothing fails.** DeepSeek ignores the surplus params silently.
- **The README agrees with the code**, so reading one confirms the other.
- The observation that flash reasons unasked only arrived with bug 85.

## The fix

1. Replace `isThinkingEnabled(body)` with a decision that reads
   `params.model` against the same `thinksByDefault` / `thinkingTurnRule`
   facts `models.ts` and `index.ts` now declare, so "no `thinking` key on a V4
   model" resolves to *thinking*, not to *not thinking*. The shared evaluator
   is `lib/llm/thinking-turn.ts` host-side; the plugin needs the equivalent
   two-line judgement over its own catalogue rather than a host import.
2. Correct the README: the V4 models reason by default, `thinking: disabled`
   turns it off, and `reasoning_effort` dials it.

Neither is a prerequisite for anything, and neither caused bug 85's 400.

## Verification

Send a turn on a `deepseek-v4-flash` profile with `parameters: '{}'` and a
non-default `temperature`. The request body currently carries `temperature`;
after the fix it should not, and the reply should still carry
`reasoningContent`.
