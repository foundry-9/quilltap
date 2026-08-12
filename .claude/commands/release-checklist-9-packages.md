# Release Checklist 9 — Published Packages & Consistent Installs

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 9 of 13):** If any `packages/` changed, make sure they're published to npmjs and correctly installed everywhere they're consumed — other packages, plugins, and the root `package.json`.

> **Hard stop (CLAUDE.md):** For `packages/` changes, bump the version, then **stop and ask the human to `npm publish`** — never hand-copy package contents into place. **Exception:** `packages/quilltap` (the CLI) still gets its version bumped but publishes automatically at release, so no manual publish request.

## Steps

1. Detect which packages changed since the last release:
   ```bash
   LAST_TAG=$(git describe --tags --abbrev=0 --match '[0-9]*.[0-9]*.[0-9]*' 2>/dev/null)
   git diff --name-only "${LAST_TAG}"..HEAD -- 'packages/**' | sed -E 's#(packages/[^/]+)/.*#\1#' | sort -u
   ```
2. For each changed package (except `packages/quilltap`):
   - Confirm its `version` in `package.json` was bumped.
   - Check whether that version is on npm:
     ```bash
     npm view <package-name> version
     ```
   - If not published, **ask the human to `npm publish`** it. Do not work around a publish failure — fix the npm problem.
3. Once published, verify every consumer references the new version. Find dependents:
   ```bash
   grep -rn "\"<package-name>\"" --include='package.json' . | grep -v node_modules
   ```
   Update the version ranges and run `npm install` at each consumer (root, other packages, plugins) so lockfiles match.
4. For `packages/quilltap`: confirm the version bump only; it auto-publishes at release.
5. Verify: `npx tsc` and `npm run test:unit` still pass with the updated deps.

## Report

List changed packages, their new versions, published-status, and the consumers you updated. Flag anything awaiting a human `npm publish`. Do not commit.
