# Bug 80 — a project's story background is ignored inside the workspace

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-18 (user report: a project set to "Latest chat background" kept showing the theme/default image instead) |
| **Fixed** | 2026-08-18 |
| **Severity** | Medium (a user-facing setting silently does nothing; no data loss) |
| **Who it bites** | anyone opening a project in a workspace tab — i.e. the default UI since `5d616727`. Every `backgroundDisplayMode` other than `theme` (`latest_chat`, `project`, `static`) is affected equally. The legacy `/prospero/[id]` route is unaffected |
| **Provenance** | Introduced by `5d616727` (2026-06-21, "tabbed two-pane workspace"), which added the arbitrated workspace backdrop and suppressed the per-view background layer without giving the project detail view a reporter |
| **Defect site** | `app/styles/qt-components/_workspace.css:108` — `.qt-workspace .qt-page-container::before { display: none }` kills the layer that painted `--story-background-url`; `app/prospero/[id]/ProjectDetailView.tsx` set that variable but never called `useReportWorkspaceBackdrop`, so it contributed nothing to the backdrop that replaced it; `app/prospero/ProsperoView.tsx:35` — `useSubsystemBackgroundStyle('prospero')` sat at the top of the component and kept reporting the Prospero subsystem image under the tab's id even after the view drilled into a project, so that stale entry is what painted |
| **Fix site** | `app/prospero/[id]/ProjectDetailView.tsx` — reports `storyBackgroundUrl` (falling back to the Prospero subsystem image) to the workspace backdrop; `app/prospero/ProsperoView.tsx` — the list's page shell, and with it the subsystem background's reporter, moved into a `ProsperoListShell` component that unmounts while a project detail is shown, so exactly one reporter holds the tab's registry key at a time |
| **v5 status** | Not applicable — the workspace shell and its backdrop arbitration are v4 UI with no v5 counterpart yet |
| **Index** | [bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-18).** Two edits, because the bug has two halves: the
project detail never *offered* its background to the backdrop, and the list
view never *stopped* offering its own.

## Symptom

Set a project's **Story Backgrounds** to "Latest chat background" (or
"Project background", or a static upload). Generate a background in one of the
project's chats. Open the project. The page shows the theme's Prospero image —
or nothing — never the chat's background. The chat itself shows it correctly,
and `GET /api/v1/projects/<id>?action=get-background` returns the right URL, so
nothing server-side is wrong.

## Root cause

`ProjectDetailView` paints its background the pre-workspace way: an inline
`--story-background-url` on a `.qt-page-container`, picked up by the `::before`
layer in `app/styles/qt-components/_content.css`.

The workspace replaced that mechanism. Because each pane's layer is
viewport-fixed, two panes painted over each other in a split, so `5d616727`
introduced one arbitrated backdrop (`components/workspace/workspace-backdrop.tsx`)
and suppressed the per-view layer inside `.qt-workspace`. Views now *report*
their background to a registry keyed by workspace tab id, and
`WorkspaceBackdrop` paints the winner.

`ProjectDetailView` was never converted. Inside the workspace its `::before` is
`display: none`, and it reports nothing — so its background reaches the screen
by neither route.

What paints instead is the tab's stale entry. `ProsperoView` renders both the
project list and, when drilled in, the detail; `useSubsystemBackgroundStyle('prospero')`
sat at the top of that component, and hooks cannot be conditional, so it went on
reporting the Prospero subsystem image under the tab's id no matter which of the
two was on screen. That is the "theme's background" in the report.

## Why it survived

The legacy route `/prospero/[id]` still renders `ProjectDetailView` outside
`.qt-workspace`, where the `::before` layer works and the background appears
correctly — so the feature looks fine anywhere it is tested off the workspace.
Nothing throws, nothing logs, and the API keeps returning the right URL, so the
only signal is the pixels.

## The fix

`ProjectDetailView` now calls `useReportWorkspaceBackdrop`, reporting
`storyBackgroundUrl` and falling back to the Prospero subsystem image when the
project asks for no background of its own (`theme` mode), which keeps that mode
looking as it does today. The call is a no-op outside the workspace, so the
legacy route is untouched.

The list view's `useSubsystemBackgroundStyle` call moved into a new
`ProsperoListShell` component that wraps only the list's JSX. Drilling into a
project unmounts it, so its reporter is gone rather than merely outvoted. This
matters more than it looks: the registry keys on the tab id, so two live
reporters in one tab race, and which one wins depends on whose effect happened
to run last — the detail wins when it mounts alone a commit later, the subsystem
wins when both mount together (a deep-linked project tab). React runs every
effect destroy before any create, so unmounting one reporter as the other mounts
makes the outcome deterministic instead.

## How to verify

1. In a workspace tab, open a project whose **Story Backgrounds** is set to
   "Latest chat background", with at least one chat in it that has a generated
   background. The project page shows that chat's background.
2. Set the mode to "Theme colors". The page falls back to the Prospero
   subsystem image, as the project list does.
3. Open the project as a deep link (a fresh tab straight onto the project, not
   drilled in from the list) — same result, which is the case the two competing
   reporters used to lose.
4. Split the workspace with a Salon on the other side: a conversation with a
   background still wins full-screen, per the backdrop's arbitration rule.
5. `npx jest __tests__/unit/components/workspace/workspace-backdrop.test.tsx` —
   the "lets a drilled-into detail replace its list view background" case pins
   the swap.
