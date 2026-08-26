# Global Search — Documents Chip (Search All Document Stores)

**Status:** ✅ Implemented — shipped 2026-08-25 in 4.9-dev
**Scope:** quilltap-server (search UI, `/api/v1/ui/search` route, mount-index query layer); no shell impact
**Verified against codebase:** 2026-08-25

## As built

All five phases landed as specified. Deltas worth knowing:

- **Only Document-Mode-openable file types are searched** (`markdown`, `txt`,
  `json`, `jsonl` — `EDITABLE_TEXT_FILE_TYPES` in
  [`lib/schemas/mount-index.types.ts`](/lib/schemas/mount-index.types.ts)). The
  non-goals ruled out blobs and unextracted files; PDFs and DOCX carry extracted
  text but can't be *opened*, and a result that can't be clicked is worse than
  no result.
- **The archived-vault lookup fails closed.** If
  `getArchivedCharacterVaultMountPointIds()` throws, every `storeType:
  'character'` store is dropped from the scan rather than the search failing or
  a tombstone leaking.
- **`ALL_SEARCH_TYPES`** in [`components/search/types.ts`](/components/search/types.ts)
  replaced all three copies of the ordered type list — the dialog's chips and
  the route's `VALID_TYPES` both read it (the dead copy in `search-bar.tsx` is
  gone).
- **The name-vs-UUID decision was extracted**, not reimplemented:
  `docStoreAuthority` in [`qtap-uri.ts`](/lib/doc-edit/qtap-uri.ts) now backs
  both `formatDocStoreUri` and the new `buildDocStoreRefResolver`
  ([`uri-producers.ts`](/lib/doc-edit/uri-producers.ts)).
- **LIKE escaping** lives in one place —
  [`lib/database/repositories/like-escape.ts`](/lib/database/repositories/like-escape.ts)
  — shared by both new repository queries.
- **In-chat opening** was extracted to
  [`lib/documents/open-document-in-chat.ts`](/lib/documents/open-document-in-chat.ts);
  `qtap-link-provider.tsx` now calls it too.
- **Measured, not assumed:** on a 7,388-chunk / 21 MB corpus (Friday) the
  content scan is a few milliseconds; the debug log carries `elapsedMs`. Phase 2
  (FTS5) stays unnecessary.

Pre-existing defects listed at the bottom of this document were left alone, as
scoped.

## Summary

Extend the global search bar (⌘K) to search **all document stores** — every enabled
mount point, character vaults included — for the typed search terms, matching file
names, relative paths, and extracted document text. Results appear under a new
**Documents** type with its own filter chip in the search dialog. Clicking a
document result opens it in Document Mode:

- **If a Salon chat is currently active** (the focused workspace tab is a Salon
  tab, or the user is on `/salon/[id]` directly): open the document *in that
  chat* via the normal chat Document-Mode flow — the Librarian posts its usual
  "opened" announcement and the chat sees subsequent saves, exactly as if the
  user had opened it from the composer's document picker.
- **Otherwise:** open it in **standalone Document Mode** (the `document-standalone`
  workspace tab), which by design posts no Librarian messages and notifies no
  chat of the open or of any edits.

## Goals

- Keyword (substring) search across every enabled document store's file names,
  paths, and extracted text, from the same search box as everything else.
- A `documents` entry in the `SearchType` union, with chip, icon (📄), group
  header, counts, and pagination behaving like the existing five types.
- Result cards show store name, relative path, and a highlighted content snippet.
- Click-to-open with the Salon/standalone branching described above.
- Sensible default even without JS interception: the result's `url` is a
  standalone deep link, so middle-click/open-in-new-tab never notifies a chat.

## Non-goals

- **Semantic search in the search bar.** The bar is substring search everywhere;
  documents follow suit. The embedding-backed operator endpoint
  (`POST /api/v1/mount-points?action=semantic-search`,
  [route.ts:80](/app/api/v1/mount-points/route.ts)) stays as-is (note: it
  currently has zero UI consumers — a possible future "deep search" affordance,
  out of scope here).
- **An FTS5 index.** v1 is a bounded `LIKE` scan over the mount-index DB (see
  Performance). FTS5 over `doc_mount_chunks.content` is the designated Phase 2
  if benchmarks demand it.
- Searching blob files, files with failed/pending extraction, or store *names*
  themselves (only their contents/filenames).
- Fixing the pre-existing search defects catalogued at the bottom (file those as
  bugs separately).

## Known state (verified 2026-08-25)

### The search feature today

- UI: `components/search/search-bar.tsx` (inline dropdown + ⌘K),
  `components/search/search-dialog.tsx` (modal with filter chips, infinite
  scroll), `components/search/search-results.tsx` (grouped cards),
  `components/search/types.ts` (shared contract).
- `SearchType = 'chats' | 'characters' | 'tags' | 'memories' | 'messages'`
  ([types.ts:3](/components/search/types.ts)). The ordered array is duplicated in
  `search-bar.tsx:11` (dead), `search-dialog.tsx:21` (live), and
  `app/api/v1/ui/search/route.ts:29` (`VALID_TYPES`) — all three must gain
  `documents`.
- Backend: single `GET /api/v1/ui/search` route
  ([route.ts](/app/api/v1/ui/search/route.ts)); params `q` (≥2 chars), `types`
  (CSV), `limit` (≤50), `offset`. Response: `{ results, totalCount, query,
  types, hasMore, countsByType }`, **no data envelope**. Each result carries
  `BaseSearchResult` (`id, type, name, matchedField, matchedValue, snippet, url,
  matchPriority, createdAt, updatedAt`). All branches are debounce-triggered
  substring matches; sort is `matchPriority` asc then `updatedAt` desc;
  `countsByType` is computed before slicing.
- Result clicks are plain `<Link href={result.url}>`; inside `/workspace`,
  `WorkspaceLinkInterceptor` + `parseHrefToIntent`
  ([route-to-intent.ts](/lib/navigation/route-to-intent.ts)) turn known hrefs
  into `openTab` calls. **There is no document mapping in `parseHrefToIntent`**,
  so document results need explicit click handling (or a new intent mapping —
  see Design).
- No existing tests cover the search bar, dialog, or route.

### Document stores and what is searchable

- Enumerate all stores: `repos.docMountPoints.findEnabled()`
  ([doc-mount-points.repository.ts:141](/lib/database/repositories/doc-mount-points.repository.ts)).
  Character vaults are ordinary mount points (`storeType: 'character'`,
  `mountType: 'database'`) and appear in that enumeration; archived characters'
  pruned vaults **also** remain enabled and enumerable
  ([archive-service.ts](/lib/characters/archive-service.ts) deliberately leaves
  the mount point alone).
- Extracted text lives in two searchable places in the mount-index DB
  (`quilltap-mount-index.db`, schema in [DDL.md](/docs/developer/DDL.md#mount-index)):
  - `doc_mount_file_links` — one row per document location:
    `fileName`, `relativePath` (unique per store, NOCASE), `extractedText`,
    policy columns `allowEmbed` / `allowCharacterRead` / `allowCharacterWrite`.
  - `doc_mount_chunks` — extraction-time chunks keyed by **`linkId`**:
    `content` (plain text, present even when `embedding` is NULL),
    `chunkIndex`, `headingContext`. No index on `content`.
- Existing keyword search (`doc_grep`,
  [text-handlers.ts:523](/lib/tools/handlers/doc-edit/text-handlers.ts)) is
  chat-tool-only, requires a project context, and scans linearly — it is **not**
  reusable here. The global UI search route does not touch documents at all.
- Canonical document identity for opening later: `(mountPointId, relativePath)`;
  the human/model-readable serialization is a `qtap://` URI
  ([qtap-uri.ts](/lib/doc-edit/qtap-uri.ts)). Chunks key on `linkId`; `fileId`
  is content identity (sha256) and must not be used as document identity.
- Per-document policy: `character_read: false` gates *characters*, not the
  operator. The existing operator surfaces pass `includeBlocked: true` /
  `operatorOverride: true` (e.g.
  [mount-points/route.ts:127](/app/api/v1/mount-points/route.ts)). Global search
  is an operator surface → blocked docs **are** searchable (see Decisions).

### Document Mode opening seams

- **In-chat:** `POST /api/v1/chats/[id]?action=open-document`
  ([actions/documents.ts:503](/app/api/v1/chats/[id]/actions/documents.ts))
  creates/reactivates the `chat_documents` row and posts the Librarian
  `opened-by-user` announcement (line ~556). The full client choreography
  already exists in `components/providers/qtap-link-provider.tsx:122-175`:
  focus the chat → `openDocumentForChat(...)`
  ([documentModeApi.ts](/app/salon/[id]/hooks/documentModeApi.ts)) → open the
  `document` workspace tab with the returned `chatDocumentId` → dispatch the
  `qtap-document-opened` window event that `useDocumentMode` listens for.
- **Standalone (chat-free):** `POST /api/v1/documents?action=open-document`
  ([documents/route.ts](/app/api/v1/documents/route.ts)) — its header comment is
  explicit: *no `chat_documents` chat rows, no Librarian announcements*. (It
  records recent-doc history under the reserved sentinel `STANDALONE_CHAT_ID`.)
  UI is workspace tab kind `document-standalone`
  ([StandaloneDocumentView.tsx](/components/workspace/StandaloneDocumentView.tsx)),
  payload `{ docKey, scope, mountPoint, filePath }` where `docKey =
  standaloneDocKey(scope, mountName, filePath)`
  ([types.ts:94](/lib/workspace/types.ts)) and `mountPoint` is the **mount
  name** (UUID accepted by the resolver when the name is ambiguous/reserved).
  URL intent already consumed by `WorkspaceIntent.tsx:110-124`:
  `/workspace?open=document-standalone&scope=document_store&mountPoint=<name>&filePath=<path>`.
  This is the exact pattern the left rail's "Document Mode" button uses
  ([sidebar-footer.tsx:191-196](/components/layout/left-sidebar/sidebar-footer.tsx)).
- Standalone saves/renames/deletes likewise post nothing — the "without a chat
  being notified of opening **or changes**" requirement is satisfied by routing
  through `/api/v1/documents`, full stop. No new suppression flag is needed.

## Decisions

1. **Which stores:** all `enabled` mount points, character vaults included
   (the user asked for **ALL**), **except vaults belonging to archived
   characters**. Archived characters are tombstones; surfacing their vault
   contents in search invites edit paths the archive guards exist to prevent.
   Exclusion = the set of `characterDocumentMountPointId` values of archived
   characters (cheap main-DB query; use a raw/non-vault-validating read).
2. **Operator visibility:** `character_read: false` / `embed: false` documents
   are included — this is a human-operator surface, mirroring
   `includeBlocked: true` on the existing operator semantic-search endpoint.
3. **What "in a Salon chat" means:** the focused workspace pane's active tab is
   kind `salon` (via the workspace provider — same source the toolbar bridge
   uses), or the current pathname matches `/salon/[id]` when the workspace
   shell isn't hosting. Merely *having* a Salon tab open in a background pane
   does not count; the open follows focus.
4. **In-chat opens are chat-visible on purpose.** The Librarian `opened-by-user`
   announcement and subsequent save announcements fire exactly as they do for
   picker-opened documents. Only the *standalone* branch is silent.
5. **The result `url` is the standalone deep link.** The safe default
   (new-tab, no-JS, workspace remount) never notifies a chat; the in-chat
   upgrade happens only through the intercepted click handler.
6. **Search fields and priority:** `fileName` exact match → `matchPriority 0`;
   `fileName`/`relativePath` substring → `1`; extracted-text (chunk `content`)
   substring → `2`. Matches the spirit of `getMatchPriority` in the route.
7. **One result per document** (per `linkId`), not per chunk: the
   best-priority match wins; the snippet comes from the first matching chunk
   (with `headingContext` prefixed when present), or the path itself for
   filename-only matches.

## Design

### 1. Backend: cross-store text search (`lib/mount-index/document-text-search.ts`)

New module beside `document-search.ts` (semantic) — deliberately parallel naming:

```ts
export interface DocumentTextSearchResult {
  linkId: string;
  mountPointId: string;
  mountPointName: string;
  mountPointRef: string;        // name, or UUID when name is reserved/ambiguous
  storeType: 'documents' | 'character';
  relativePath: string;
  fileName: string;
  matchedField: 'fileName' | 'relativePath' | 'content';
  snippet: string;
  matchPriority: 0 | 1 | 2;
  updatedAt: string;
}

export async function searchDocumentText(
  query: string,
  opts: { limit?: number; excludeMountPointIds?: string[] }
): Promise<{ results: DocumentTextSearchResult[]; totalCount: number }>
```

Implementation:

- Resolve scope: `repos.docMountPoints.findEnabled()` minus
  `getArchivedCharacterVaultMountPointIds()` (new small helper, likely in
  `lib/mount-index/character-vault.ts`, reading archived characters' vault ids
  without the vault-validating character read path).
- Two repo-level queries against the mount-index DB (new repository methods —
  raw SQL lives in repositories per house style):
  - `docMountFileLinks.searchByNameOrPath(query, mountPointIds, limit)` —
    `fileName LIKE ? OR relativePath LIKE ?` (escaped `%q%`, NOCASE).
  - `docMountChunks.searchContent(query, mountPointIds, limit)` —
    `content LIKE ?` joined to `doc_mount_file_links` for path/name, grouped by
    `linkId` taking the lowest `chunkIndex` match. `LIMIT` with a generous cap
    (e.g. 200 matched links) so the scan short-circuits.
- Merge (filename hits shadow content hits for the same `linkId`), rank by
  `matchPriority` then `updatedAt` desc, build snippets (trim the chunk to
  ~200 chars centred on the match — same visual treatment as message snippets).
- `mountPointRef`: mirror `formatDocStoreUri`'s logic
  ([qtap-uri.ts:320](/lib/doc-edit/qtap-uri.ts)) — emit the store name unless it
  collides with a reserved authority (`self`/`project`/`general`) or another
  store's name case-insensitively, in which case emit the UUID. Reuse/extract
  the existing resolver from `lib/doc-edit/uri-producers.ts` rather than
  reimplementing.
- Debug logging throughout per the logging convention (query length, store
  count, hit counts, elapsed ms).

**Performance stance:** brute-force `LIKE` is consistent with every other
branch of this route (messages are a regex collection scan; memories are a
per-character loop). Chunk content for a large instance is bounded by what
extraction stored; a `LIKE` scan over `doc_mount_chunks.content` with an early
`LIMIT` is expected to be tens of ms at realistic sizes. Add a timing debug log;
if a real instance (e.g. Friday-scale) shows >150 ms scans, Phase 2 is a
contentless FTS5 table over `(linkId, content)` maintained by the same writers
that maintain chunks (`scanner.ts`, `reindex-file.ts`) — schema change would
then need DDL.md + migration + backup-restore review.

### 2. Backend: route branch (`app/api/v1/ui/search/route.ts`)

- Add `'documents'` to `VALID_TYPES`.
- New `searchDocuments(query, limit)` branch calling `searchDocumentText`.
  Map to a new result shape:

```ts
export interface DocumentSearchResultItem extends BaseSearchResult {
  type: 'documents';
  mountPointId: string;
  mountPointName: string;
  mountPointRef: string;
  storeType: 'documents' | 'character';
  relativePath: string;
}
```

- `name` = `fileName`; `id` = `linkId`; `url` =
  `/workspace?open=document-standalone&scope=document_store&mountPoint=${encodeURIComponent(mountPointRef)}&filePath=${encodeURIComponent(relativePath)}`.
- Wire into `countsByType`, `totalCount`, sorting, pagination like the other
  branches. Skip the branch entirely when `documents` isn't in the requested
  types (don't repeat the characters-always-loaded mistake at `route.ts:137`).

### 3. Frontend: types, chip, card

- `components/search/types.ts`: extend `SearchType`, add
  `DocumentSearchResultItem`, `TYPE_ICONS['documents'] = '📄'`,
  `TYPE_LABELS`/`TYPE_LABELS_PLURAL` (`'Document'`/`'Documents'`).
- `search-dialog.tsx:21` and `search-bar.tsx:11`: add `'documents'` to
  `ALL_TYPES` (the chip label auto-derives as "Documents"). While there,
  either delete the dead `ALL_TYPES` in `search-bar.tsx` or start using it —
  don't leave a third divergent copy.
- `search-results.tsx`: new `DocumentResultCard` — 📄 icon, `fileName` as
  title, `mountPointName · relativePath` as the subtitle line, highlighted
  snippet via the existing `HighlightedText`. Group header comes free from the
  existing grouping reduce.

### 4. Frontend: click-to-open branching

New hook `lib/hooks/use-open-document-from-search.ts` (client), used by both
`SearchBar` and `SearchDialog`, replacing the plain `<Link>` behavior **for
document results only** (other types keep their current links):

```
onClick(result):
  activeChatId = useActiveSalonChat()          // null when no Salon focused
  if (activeChatId):
    openDocumentInChat(activeChatId, {
      scope: 'document_store',
      mountPoint: result.mountPointRef,
      filePath: result.relativePath,
    })                                          // extracted shared helper, see below
  else if (inside workspace shell):
    openTab('document-standalone', {
      docKey: standaloneDocKey('document_store', result.mountPointRef, result.relativePath),
      scope: 'document_store',
      mountPoint: result.mountPointRef,
      filePath: result.relativePath,
    }, { title: result.name })
  else:
    router.push(result.url)                     // WorkspaceIntent consumes it
  closeSearchUI()
```

- **`openDocumentInChat`**: extract the existing choreography from
  `qtap-link-provider.tsx:122-175` (focus chat → `openDocumentForChat` → open
  `document` tab parented to the Salon tab → dispatch `qtap-document-opened`)
  into a shared helper both call sites use. Single source of truth; the link
  provider keeps its qtap-URI parsing, the search hook supplies parts directly.
- **`useActiveSalonChat`**: reads the workspace provider's focused-pane active
  tab (the same focus model `WorkspaceToolbarBridge` follows); falls back to a
  `/salon/[id]` pathname match outside the workspace shell. Keep it a small,
  tested pure resolver over `(focusedTab, pathname)`.
- The card remains an `<a href={result.url}>` under the hood so middle-click /
  copy-link work and default to the silent standalone open; the handler calls
  `preventDefault()` for plain left-clicks only (mirror
  `WorkspaceLinkInterceptor`'s modifier-key etiquette).
- Respect the keep-alive rule: inside `/workspace`, never `router.push` for
  document results (it would remount a streaming Salon).

### 5. Edge cases

- **Store renamed between search and click:** the resolver 404s → surface the
  standalone view's existing not-found handling; no special casing in v1.
- **Ambiguous / reserved store names:** handled server-side by emitting the
  UUID as `mountPointRef` (the resolver accepts either).
- **Documents inside the active chat's already-open set:** `open-document`
  reactivates rather than duplicates (unique `(chatId, filePath, scope,
  mountPoint)`), so re-clicking focuses the existing pane. No client work.
- **Character-vault results:** open standalone like any other store. Writes to
  a *live* character's vault via the operator path are already sanctioned;
  archived vaults never appear (excluded at search time).
- **`project` scope:** not emitted. Even for a store that happens to be a
  project's official store, `document_store` + name addresses it fine, and the
  standalone API only accepts `document_store | general`.

## Implementation phases

1. **Mount-index query layer** — repo methods
   (`searchByNameOrPath`, `searchContent`), `document-text-search.ts`,
   `getArchivedCharacterVaultMountPointIds()`, unit tests (real-driver tests
   follow the absolute-root-path `better-sqlite3` require convention).
2. **Route branch** — `documents` type end-to-end in `/api/v1/ui/search`,
   route unit tests (new; also cover the existing contract while at it, since
   the route has none).
3. **UI type plumbing** — types, chips, `DocumentResultCard`, dialog/bar
   arrays.
4. **Open-on-click** — extract `openDocumentInChat`, add
   `useActiveSalonChat` + `useOpenDocumentFromSearch`, wire into both search
   surfaces. Unit-test the branch resolver.
5. **Docs & polish** — see checklist below.

## Testing

- `__tests__/unit/lib/mount-index/document-text-search.test.ts` — matching,
  priority, snippet extraction, archived-vault exclusion, disabled-store
  exclusion, ambiguous-name UUID fallback, LIKE-metacharacter escaping
  (`%`, `_` in queries).
- `__tests__/unit/app/api/v1/ui/search/route.test.ts` — new `documents`
  branch: shape, counts, pagination, `types` filtering, skip-when-unrequested.
- `__tests__/unit/lib/hooks/use-open-document-from-search.test.ts` (or a pure
  resolver test) — Salon-focused → in-chat; workspace-no-salon → standalone
  tab; outside workspace → URL push; modifier-click → no interception.
- Manual pass in V4test (never Friday): search a term known to exist in a
  store; verify chip, card, in-chat open (Librarian message appears),
  standalone open (no Librarian message, edits post nothing to any chat),
  middle-click.

## Documentation checklist (pre-commit obligations)

- `help/search.md` — add Documents to "Search Types" / "What Gets Indexed" /
  limitations (only extracted text is searched; blobs and unindexed files are
  not). Steampunk voice; keep the `url` frontmatter + In-Chat Navigation
  `help_navigate` call consistent.
- `docs/developer/API.md` — the `/api/v1/ui/search` section is already stale
  (documents a singular `type` param, omits `limit`/`offset`/`countsByType`);
  rewrite it correctly while adding the `documents` type.
- `docs/CHANGELOG.md` — plain-English entry.
- No schema changes in v1 → no DDL.md / export-schema / migration work.
  (Phase 2 FTS5, if it happens, triggers all of those.)

## Pre-existing defects noticed during research (file separately, out of scope)

1. Tag results link to `/gallery?tag=…` — no such route exists; dead links
   (`route.ts:255`).
2. Message results' `?msg=` deep-link param is dropped by `parseHrefToIntent`
   inside the workspace.
3. Character/memory result URLs (`/aurora/{id}`, `/aurora/{id}?tab=memories`)
   have no tab intent → clicking them remounts the workspace; `/aurora/{id}/view`
   forms would map cleanly.
4. Memory search is a sequential per-character repo loop on every debounced
   query (`route.ts:216`).
5. `types.ts:5` `MatchPriority` doc comment contradicts `getMatchPriority`;
   `route.ts:99` has a `}const` formatting jam; dead `ALL_TYPES`/`router` in
   the search components; tag cards render a hardcoded "Used 0 times".
6. `/workspace?open=document&chatId=X` deep-links are dead
   (`WorkspaceIntent.tsx:88` drops `chatDocumentId`) — unaffected by this
   feature, which uses `document-standalone` and direct `openTab` calls.

## Open questions

1. Should **live** characters' vaults be excluded too? Prior art hides them
   from the composer's file picker (`LibraryFilePickerModal`), but the
   Scriptorium grid shows them and the user asked for *all* stores. Default
   here: include live, exclude archived.
2. Should the inline dropdown (not just the dialog) cap document results lower
   than other types to keep the popover short? Default: no special casing;
   the existing per-type grouping and "See all results" flow already handle it.
3. Snippet length / multi-match display (show "3 matches in this document"?)
   — v1 shows the first match only; revisit with usage.
