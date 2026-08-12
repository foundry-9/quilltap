# Release Checklist 4 — API Endpoint Standard

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 4 of 13):** Every API endpoint must adhere to the `/api/v{version}/{entityname}` standard (currently `/api/v1/{entityname}`), using the `?action=` dispatch pattern. The **only** non-versioned exceptions are:

- `/api/health`
- `/api/plugin-routes/[...path]`
- `/api/themes/*`

## Steps

1. List every API route and flag anything outside `/api/v1/` that isn't a sanctioned exception:
   ```bash
   find app/api -name 'route.ts' -o -name 'route.tsx' | sort
   ```
   ```bash
   # Non-v1 routes (should only be the three exceptions):
   find app/api -name 'route.ts' | grep -vE 'app/api/v1/|app/api/health|app/api/plugin-routes|app/api/themes/'
   ```
2. For each **new or changed** route since the last release, confirm it:
   - Lives under `/api/v1/` with the collection/item/system shape from CLAUDE.md.
   - Uses `createContextHandler` / `withContext` from `@/lib/api/middleware`.
   - Uses `withActionDispatch` / `withCollectionActionDispatch` for non-CRUD verbs via `?action=` rather than per-action route segments.
   - Uses response helpers from `@/lib/api/responses` (`successResponse`, `badRequest`, `notFound`, …).
   - Handles async request APIs correctly (`await params`, `await cookies()`, `await headers()`).
   ```bash
   LAST_TAG=$(git describe --tags --abbrev=0 --match '[0-9]*.[0-9]*.[0-9]*' 2>/dev/null)
   git diff --name-only "${LAST_TAG}"..HEAD -- 'app/api/**' | sort -u
   ```
3. Fix any violation. Remember the UI-route renames don't move the API paths — characters/chats/projects APIs stay at `/api/v1/characters`, `/api/v1/chats`, `/api/v1/projects`.
4. Cross-check against [API.md](../../docs/developer/API.md); if routes changed, that doc is updated in checklist item 13 — note it here.

## Report

Confirm the non-v1 route list contains only the three sanctioned exceptions. For each new/changed route, mark **COMPLIANT** or **FIXED** (`file:line`). Do not commit.
