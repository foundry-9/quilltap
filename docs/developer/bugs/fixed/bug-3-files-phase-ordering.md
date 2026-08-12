# Bug 3 — the files phase runs before anything can receive the bytes

| | |
|---|---|
| **Status** | Fixed in v4 (2026-07-26) |
| **Found** | 2026-07-26 |
| **Fixed** | 2026-07-26 |
| **Severity** | **Critical** |
| **Who it bites** | every restore into a fresh or wiped target |
| **Fix size (as estimated)** | move one block |
| **Fix site** | `lib/backup/restore/restore.ts` — step 5 moved to 22a-bis |
| **v5 status** | Converged — files run after 22a on both sides |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: Critical.** This is the broadest of the three, and the reason
fixing Bug 2 alone would appear to do nothing.

### Symptom

Restoring into a fresh or wiped target restores no user file, in **either**
mode (`replace` and `new-account`).

### Root cause

`restore.ts` restores in a numbered list its own comment calls *"dependency
order"* (`:65`). Files are **step 5** (`:128`). At that moment neither bridge to
a store can resolve:

- a **project-less** file needs the Quilltap Uploads mount — which
  `deleteUserData` has just `DELETE`d (`lib/backup/delete-service.ts:72`
  truncates `doc_mount_points`). `instance_settings` is deliberately *not*
  cleared, so the pointer survives and dangles.
- a **project-bound** file needs a project store, which does not restore until
  **step 13** (`:292`) — eight phases later.

The document-store mount points themselves do not arrive until **22a**
(`:430`).

### Why it survived

The order is correct for an in-place restore over a populated instance, where
the stores happen to already exist. It only fails when the target is fresh or
wiped — which is exactly the disaster-recovery case restore exists for.

### The fix

Move the step-5 files block to run **after 22a** (document store mount points),
which also puts it after projects (13) and groups (13a). **No write changes —
only when it happens.** Renumber the comment so the list stays readable, and
keep the block's internal order intact.

This is what the v5 port does, and its restore differential passes against v4's
own archives with it.

### Verification

Restore into a **fresh** instance (not an in-place restore — that is the case
that already works) and confirm file bytes land in the right store. Do this for
a project-less file and a project-bound file, in both `replace` and
`new-account` modes.
