# Release Checklist 5 — Dead Code Sweep

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 5 of 13):** Find and remove dead code, then update the [dead code report](../../docs/developer/DEAD-CODE-REPORT.md).

## Steps

1. Run the dead-code analyzer:
   ```bash
   npx knip
   ```
   `knip` reports unused files, exports, dependencies, and types. Treat its output as **candidates**, not gospel — it has false positives here.
2. For each candidate, verify it's truly unused before deleting:
   - Dynamic imports, plugin entry points, migration scripts, CLI subcommands, Storybook stories, and anything referenced only by string/config can look dead but aren't.
   - Confirm with a real search:
     ```bash
     grep -rn "theSymbolName" lib app packages plugins migrations --include='*.ts' --include='*.tsx'
     ```
3. Remove genuinely dead code and its now-orphaned tests. Run `npx tsc` and `npm run test:unit` to confirm nothing broke.
4. Update [DEAD-CODE-REPORT.md](../../docs/developer/DEAD-CODE-REPORT.md): record what was removed, and note any knip findings you're deliberately keeping (with the reason).

> Note: per project memory, `jest --findRelatedTests` is unreliable here — use the full `npm run test:unit` to validate.

## Report

Summarize removed items (`file:line` or file), items kept-with-reason, and the final `npx tsc` / test status. Confirm DEAD-CODE-REPORT.md was updated. Do not commit.
