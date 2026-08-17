# Bug 74 — tagging a connection profile has never worked: the editor calls a route that does not exist, the action it wants was never built, and the card renders the wrong shape

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-16 (v4's own browser verification of bugs 72/73 on V4test — two 404s in the network log while the profile modal was open) |
| **Fixed** | 2026-08-17 |
| **Severity** | Medium (a whole affordance dead end to end; the read fails silently, the write fails with a generic toast, and no profile has ever carried a visible tag) |
| **Who it bites** | anyone who opens a connection profile — the failing reads fire on open — and anyone who tries to tag one |
| **Provenance** | **v4-found.** Not a port finding: the differential harness could not have caught it (v5 has no connection-profile modal yet) and no dogfood walk had tried to tag a profile |
| **Defect site** | `components/tags/tag-editor.tsx:46` (`getApiBasePath`, `profile` branch) + the absent `get-tags` action on `app/api/v1/connection-profiles/[id]/route.ts`'s GET + `components/settings/connection-profiles/ProfileCard.tsx:164-168` against `types.ts:78` |
| **Fix site** | `tag-editor.tsx` corrected path; new `get-tags` GET action with strict unknown-action rejection; new `resolveEditorTags` in `lib/api/middleware/enrichment.ts` shared with the character route; `EnrichedTag` declared in the connection-profiles client types and unwrapped in `ProfileCard` |
| **v5 status** | Not yet assessed — v5 has no connection-profile editor yet. When it grows one, take the *shape contract* from this file rather than v4's pre-fix code |
| **Index** | [bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-17).** Three independent layers, each of which alone
would have been enough to make the feature useless. The first is the one the
404 announced; the other two were only visible once it was out of the way.

**1 — the route does not exist.** `TagEditor` is entity-agnostic: it maps an
`entityType` to a base path and appends `?action=get-tags` / `add-tag` /
`remove-tag`. The `profile` branch returned `/api/v1/profiles/<id>`. Connection
profiles are served from `/api/v1/connection-profiles`, and there has never
been an `/api/v1/profiles` route at all. Corrected to the real path.

**2 — the action it wants was never built.** Even on the corrected path, the
connection-profile GET had no `get-tags` action; it ignored the parameter and
returned `{ profile: … }`. `TagEditor` reads `data.tags`, gets `undefined`, and
sets `[]` — so the corrected path would still have shown no tags, and shown no
error either. Added as a real action returning `{ tags: [...] }`.

The GET now also **refuses** an unrecognised action instead of serving the whole
profile. That leniency is precisely what let layer 2 hide: a caller asking for
something the route did not implement got a `200` and a body of the wrong
shape. The POST on the same route was already strict; the GET now matches it.

**3 — the card renders the wrong tag shape.** `enrichWithTags` — used by the
collection endpoint that `ProfileCard` renders from — returns
`EnrichedTag = { tagId, tag }` envelopes. `ProfileCard` read `tag.id` and
`tag.name` straight off the envelope, so both were `undefined`: a tagged
profile drew **an empty pill**. `ConnectionProfile.tags` was typed `Tag[]`,
which is simply not what the wire carries, and `fetchJson<any>` meant nothing
checked. The client type now declares the envelope and the card unwraps it.

Layers 2 and 3 are the same confusion twice: **two tag shapes with no owner.**
Entity payloads carry `{ tagId, tag }`; `?action=get-tags` answers flat
`{ id, name, visualStyle }` because that is what `TagEditor` and `TagBadge`
consume. Each route had open-coded its own loop, free to drift. New
`resolveEditorTags` in `lib/api/middleware/enrichment.ts` owns the flat
projection and is built *on* `enrichWithTags`, so the batching and the
"preserve the entity's own order" rule are stated once; the character route's
`get-tags` was moved onto it too, since those are the two answers `TagEditor`
must be able to read interchangeably. As a rider, the character path drops an
N+1 (`findById` per tag inside a `Promise.all`) for the batched query
`enrichWithTags` already used.

## Symptom

Open any connection profile in Settings → AI Providers → Connection Profiles.
Two requests to `/api/v1/profiles/<id>?action=get-tags` return **404** in the
network log. The Tags section shows no tags and a `+ Add Tag` button.

Add a tag: the tag itself is created (`POST /api/v1/tags` → 201, so it does
land in the `tags` table), then the attach 404s and the toast reads *"Failed to
add tag. Please try again."* Nothing is attached.

The read half is silent — `loadTags` checks `res.ok` and simply does not set
state on failure, so a profile that *did* somehow carry tags would show none
with no complaint. The write half is loud but uninformative.

## Measured, against a running server

V4test on :3005, real data:

```
GET  /api/v1/profiles/<id>?action=get-tags             -> 404
GET  /api/v1/connection-profiles/<id>?action=get-tags  -> 200  {"profile":{…}}   ← wrong shape, no `tags` key
POST /api/v1/connection-profiles/<id>?action=add-tag   -> 201  {"success":true}  ← the server half worked all along
POST /api/v1/profiles/<id>?action=add-tag              -> 404
```

And with a tag attached out-of-band, the collection endpoint the card renders
from:

```json
[ { "tagId": "05c4856a-…", "tag": { "id": "05c4856a-…", "name": "card-shape-probe", … } } ]
```

against `ProfileCard`'s `tag.name` — which is `undefined`. The card drew one
badge whose `textContent` was the empty string.

## Root cause

The server half was built and the client half was never connected to it.
`repos.connections.addTag` / `removeTag` exist, the POST actions exist and
work, `enrichProfile` computes tag details — but the only caller reached for a
path that was never registered, and the read action it needed was never added.
Because the add path fails with a generic toast rather than a 404 the user can
see, the wrong URL never announced itself as a *wrong URL*.

## Why it survived

Nothing exercised it. `TagEditor` has three entity types; `character` is used
in two places and works, `chat` has never been used anywhere, and `profile` was
used only in the connection-profile modal — a dialog people open to change a
model, not to tag. There were no tests for `TagEditor` at all, and the
component's contract with the server is a string it builds at runtime, so a
typo in it is invisible to the compiler. It surfaced only because bugs 72 and
73 sent someone to read that modal's network log for an unrelated reason.

## The fix

- `components/tags/tag-editor.tsx` — `profile` maps to
  `/api/v1/connection-profiles/<id>`.
- `app/api/v1/connection-profiles/[id]/route.ts` — a `get-tags` GET action
  answering `{ tags }`; unknown GET actions now `400` rather than falling
  through to the profile body.
- `lib/api/middleware/enrichment.ts` — new `resolveEditorTags(tagIds, repos)`
  and its `EditorTag` type, flattening `enrichWithTags`. Both `get-tags`
  routes (connection profile, character) read it.
- `components/settings/connection-profiles/types.ts` — `EnrichedTag` declared;
  `ConnectionProfile.tags` retyped from the fictional `Tag[]`.
- `components/settings/connection-profiles/ProfileCard.tsx` — unwraps the
  envelope, keyed on `tagId` (the old `tag.id || \`tag-${index}\`` fallback was
  masking exactly this: the id was always undefined, so it always fell to the
  index).

**Not done, deliberately.** `TagEditor`'s `chat` branch points at
`/api/v1/chats/<id>`, which has `add-tag` and `remove-tag` but likewise no
`get-tags` action — so a chat tag editor would half-work in the same way. No
caller passes `entityType="chat"` anywhere in the codebase, so building the
route would be speculative. Recorded here instead: **if a chat tag editor is
ever wired up, it needs a `get-tags` action on the chats GET first**, and it
should resolve through `resolveEditorTags`.

## Verification

- `__tests__/unit/components/tags/tag-editor-paths.test.tsx` — asserts the URL
  each entity type reaches for on all three operations, and that nothing ever
  requests `/api/v1/profiles/`. Checked against the pre-fix component: three of
  the five fail there (the character and chat read cases are guards and pass
  both ways).
- `__tests__/unit/lib/api/middleware/editor-tags.test.ts` — the flat shape,
  entity order preserved over storage order, dangling ids dropped without
  holes, empty/null/undefined short-circuiting without a query, and one query
  rather than one per tag.
- **In the running app** (V4test): a tag added through the modal renders as a
  badge, persists to `connection_profiles.tags` in the database, survives
  closing and reopening the dialog (which is the read path, i.e. the layer-2
  fix), removes cleanly, and shows its *name* on the profile card instead of an
  empty pill (layer 3). The network log for the whole sequence is 200/201
  throughout, where before it opened with two 404s.
