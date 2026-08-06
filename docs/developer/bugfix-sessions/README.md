# Bugfix sessions — specs for working down `found-bugs.md`

**Source:** [../found-bugs.md](../found-bugs.md) (bugs 8–43, all open at HEAD
`3adefeba`). Bugs 1–7 are already fixed and are not covered here.

Each file in this directory is a **self-contained spec for one working
session**. Bugs are batched by subsystem and shared files so one session fixes
as many bugs as possible without context-switching, and the sessions are
ordered so dependencies land first. Hand a session file to a fresh Claude
session ("please execute docs/developer/bugfix-sessions/session-N-….md") and it
has everything it needs; `found-bugs.md` remains the authority for full root
causes and measured evidence — each spec cites the relevant entries.

## Session order

| Session | Bugs | Theme | Order constraint |
|---|---|---|---|
| [1 — Corrupt-input guards](session-1-corrupt-input-guards.md) | **8**, 18 | Present-but-unreadable input must not be treated as absent | **Run first — Bug 8 is live silent data loss** |
| [2 — Store delete & restore/import integrity](session-2-restore-import-integrity.md) | 9, 10, 11, 12 | The backup/restore/import family (successor to Bugs 1–4) | Before Session 3 (Session 3 reuses its orphan-reaper pattern) |
| [3 — Mount-index & file hygiene](session-3-mount-index-file-hygiene.md) | 13, 15, 16, 38, 43 | Doc-store repository defects, picker 404, thumbnail sweep | After Session 2 |
| [4 — Embedding & memory data](session-4-embedding-memory-data.md) | 14, 17, 26 | Export bloat, oversize sub-chunking, memory-link clobber | Independent |
| [5 — Almanack ledgers](session-5-almanack-ledgers.md) | 19, 20, 21 | Three defects in one file (`phase3-ledgers.ts`) | Independent |
| [6 — Chat API state & participants](session-6-chat-api-participants.md) | 22, 23, 24, 25, 27, 36, 37 | GET projections, impersonation, dead modals | Independent |
| [7 — Message attribution & tool cards](session-7-attribution-tool-cards.md) | 28, 29, 30 | Who a message/tool run appears to come from | Independent |
| [8 — Provider attachments & streaming](session-8-provider-attachments.md) | 31, 32, 33, 34, 35 | Plugin-side vision/attachment/streaming defects | Independent; plugin version-bump rules apply |
| [9 — UI polish](session-9-ui-polish.md) | 39, 40, 41, 42 | CSS, portal, Content-Disposition, toast animation | Independent; **contains an npm-publish human gate** |

Sessions 4–9 are mutually independent and can run in any order after 1–3
(only `docs/CHANGELOG.md` will conflict trivially if run in parallel).

## Standing rules (apply to every session)

These repeat the load-bearing points; each spec also carries the ones specific
to it.

1. **v4 is the oracle for the v5 port.** Every `lib/` (or `app/` behaviour)
   change here moves the v5 baseline and obliges a v5 drift-catch-up round.
   Land sessions when the v5 side is between rounds, and prefer clustering
   several sessions into one landing so the baseline moves few times.
   **Pinned** bugs have a named v5 tripwire that will go RED when the fix
   lands — that is the tripwire *working*, not a regression; the v5 side
   retires it. **Faithful** bugs have no tripwire — v5 mirrors the defect
   exactly and owes a mirror change *in the same round*. Each spec lists its
   tripwires/mirrors; do not skip the coordination note in the final report.
2. **`docs/CHANGELOG.md`** gets an entry per fix (plain American English, no
   steampunk voice; find the existing section header, don't duplicate it).
3. **`found-bugs.md` bookkeeping:** flip each fixed bug's Status-table row to
   **Yes** with the date and fix site, mirroring how Bugs 1–7 are recorded,
   and add any "decisions taken while fixing" notes there.
4. **Tests:** every fix gets a regression test checked against the pre-fix
   code (it must fail there). Real-binding suites need the
   `@jest-environment node` docblock and must require `better-sqlite3` by
   absolute root path. Use global `jest`, bare `jest.mock` factories.
   `--findRelatedTests` is broken in this repo — run the full relevant suite.
5. **Checks before commit:** `npx tsc` (not `npm run build`), `npm run lint`
   (not `npx next lint`). Commit via the `/commit` command when the user asks.
6. **User-visible changes** need `help/*.md` coverage (with `url` frontmatter
   and an In-Chat Navigation section). Most fixes here restore documented
   behaviour — check whether the existing help text is already correct and
   only update where the fix changes what the user sees.
7. **Never write "Quilttap".** The project is Quilltap.
8. The dev server is usually running and holds the instance lock; don't kill
   it, and don't edit `lib/` while the user is mid-chat without asking.
