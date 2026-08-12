# Release Checklist 3 — Refactor to Best Practices

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 3 of 13):** Refactor according to best practices:

- Respect **encapsulation** and **single source of truth**. If a feature requires duplicate code, consider inheritance.
- **SRP** — single responsibility per module/function.
- **DRY** — don't repeat yourself.
- **KISS** — keep it simple.
- **YAGNI** — don't build for imagined futures.

## Scope

Default to the diff since the last release; pass `all` to sweep the whole tree.

```bash
LAST_TAG=$(git describe --tags --abbrev=0 --match '[0-9]*.[0-9]*.[0-9]*' 2>/dev/null)
git diff --name-only "${LAST_TAG}"..HEAD -- '*.ts' '*.tsx' | grep -vE '__tests__|\.test\.' | sort -u
```

## Steps

1. Read the changed modules and look for:
   - **Duplication** — copy-pasted logic that should be a shared helper, base class, or the existing single source of truth. Watch especially for CLAUDE.md's known chokepoints (query keys in `lib/query/keys.ts`, tool Zod schemas as source of truth, memory-gate deletion path, `applyCharacterFieldUpdates`).
   - **SRP violations** — functions/components doing several unrelated jobs; split them.
   - **Over-engineering (YAGNI)** — abstractions, options, or config with a single caller and no near-term second one.
   - **Leaky encapsulation** — reaching into another module's internals instead of its public surface.
2. Apply the refactors. Prefer inheritance/shared helpers over duplication, per house style. Do **not** invent new abstractions the code doesn't need.
3. Keep behavior identical — verify with `npx tsc` and `npm run test:unit` after each meaningful change.

## Report

List each refactor as a bullet with `file:line`, the principle it served (SRP/DRY/etc.), and what changed. Note anything you deliberately left alone and why. Confirm `npx tsc` and tests still pass. Do not commit.
