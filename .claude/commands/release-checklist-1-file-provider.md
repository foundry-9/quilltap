# Release Checklist 1 — File Provider (no direct filesystem access)

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 1 of 13):** Unless we're implementing an interface or an instance of a generic provider, this app should **never directly access the filesystem** — it should go through our generic file provider.

## Scope

By default, audit only what changed since the last release. Determine the range and scan it:

```bash
LAST_TAG=$(git describe --tags --abbrev=0 --match '[0-9]*.[0-9]*.[0-9]*' 2>/dev/null)
echo "Auditing changes since ${LAST_TAG:-<no tag found>}"
git diff --name-only "${LAST_TAG}"..HEAD -- '*.ts' '*.tsx' 2>/dev/null | sort -u
```

If the user passes `all` as an argument, audit the whole `lib/`, `app/`, and `packages/` trees instead.

## Steps

1. Grep the in-scope files for raw filesystem access:
   ```bash
   grep -rnE "require\('fs'\)|from '(node:)?fs'|from '(node:)?fs/promises'|fs\.(readFile|writeFile|mkdir|readdir|unlink|stat|createReadStream|createWriteStream)|path\.join\(" \
     lib app packages --include='*.ts' --include='*.tsx'
   ```
2. For each hit, decide whether it is **legitimate** or a **violation**:
   - **Legitimate:** the file *is* a file-provider implementation/interface, a generic provider instance, migration scripts under `migrations/`, CLI internals under `packages/quilltap/`, build tooling, or tests.
   - **Violation:** feature/business logic reaching for `fs` directly instead of going through the file provider abstraction.
3. Locate the correct abstraction (search for the file-provider/storage interface the codebase uses) and refactor each violation to use it.
4. Add or update a unit test that would have caught the violation where practical.

## Report

List each hit as **OK** (with the reason it's allowed) or **VIOLATION** (with `file:line` and the fix applied). If there are no violations, say so explicitly. Do not commit — that's the `/commit` command's job.
