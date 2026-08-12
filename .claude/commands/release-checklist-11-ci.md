# Release Checklist 11 — GitHub Actions (lint / test / build)

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 11 of 13):** Make sure lint, test, and build are passing in GitHub Actions.

## Steps

1. Inspect the workflows so you know what CI actually runs:
   ```bash
   ls .github/workflows/
   ```
2. Check the latest CI runs on the current branch via the `gh` CLI:
   ```bash
   gh run list --branch "$(git branch --show-current)" --limit 10
   ```
   For any failed/most-recent run, drill in:
   ```bash
   gh run view <run-id>
   gh run view <run-id> --log-failed
   ```
3. If CI hasn't run on the latest commit (or you want to catch failures before pushing), reproduce the CI gates locally — mirror what the workflows invoke, typically:
   ```bash
   npm run lint      # note: use `npm run lint`, NOT `npx next lint`
   npm run test:unit
   npx tsc           # type-check; the project uses `npx tsc`, not `npm run build`
   ```
   Run the actual build only if a workflow does and you need to reproduce a build-specific failure.
4. Fix any failures. Re-run the relevant command until green.

## Report

State the status of the latest Actions run (or that local lint/test/type-check pass as a proxy). List any failures found and the fixes applied. If CI can only be confirmed after pushing, say so. Do not commit or push — that's the release/commit flow's job.
