# Release Checklist 2 — Test Coverage & Regression Tests

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 2 of 13):** Expand unit-test coverage for any new functionality, and add regression tests that specifically reproduce every bug fixed since the last release (so it can never silently come back).

## Scope

```bash
LAST_TAG=$(git describe --tags --abbrev=0 --match '[0-9]*.[0-9]*.[0-9]*' 2>/dev/null)
echo "Reviewing changes since ${LAST_TAG:-<no tag found>}"
# New/changed source files that should have tests
git diff --name-only "${LAST_TAG}"..HEAD -- 'lib/**/*.ts' 'app/**/*.ts' 'app/**/*.tsx' | grep -vE '__tests__|\.test\.|\.spec\.' | sort -u
# Commits that look like bug fixes (candidates for regression tests)
git log --oneline "${LAST_TAG}"..HEAD | grep -iE 'fix|bug|regress|revert'
```

## Steps

1. For each new feature/module in the diff, confirm a matching test exists. If missing, write one. Follow the repo's jest conventions from [CLAUDE.md](../../CLAUDE.md) (GLOBAL `jest`, subject-imports-first, BARE `jest.mock` factories; real-binding suites need `@jest-environment node`).
2. For each bugfix commit, confirm there is a test that **fails without the fix**. If none exists, write a regression test that reproduces the original bug and passes only with the fix in place.
3. Run the suite and confirm green:
   ```bash
   npm run test:unit
   ```
4. Optionally check the coverage delta — coverage should not regress:
   ```bash
   npm run test:unit -- --coverage 2>/dev/null | tail -40
   ```

## Report

List each new feature/bugfix with **HAS TEST** or **ADDED TEST** (`file:line`). End with the `npm run test:unit` result (pass/fail counts). If any tests fail, show the failing output — do not paper over it.
