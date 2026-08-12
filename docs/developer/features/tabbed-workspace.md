# Feature: The Tabbed Workspace

- **Target release:** 4.8.0
- **Status:** Shipped — Phases 0–8 complete; flag on by default as of 4.8-dev (`NEXT_PUBLIC_WORKSPACE_TABS=0` to opt out)
- **Decision record:** [ADR-0001: Tabbed workspace routing model](../decisions/ADR-0001-tabbed-workspace-routing.md)

## Summary

Replace the single-page-at-a-time shell with a **tabbed workspace** that can
split into **two side-by-side panes** (left and right). A writer can keep a
conversation streaming in one pane while reading project files, character
sheets, or help in the other. Help, the Brahma Console, and the Wardrobe — today
modal dialogs — gain full-tab modes.

The app opens with a single tab (the home dashboard). Starting a conversation
opens a new tab for it. Tabs can be dragged between the left and right halves to
split the screen or rejoin a pane, can be reordered, and can be closed. Closing
the last tab returns to a single home tab. Tab layout persists to localStorage
across reloads.

## Motivation

The current shell shows one surface at a time. Comparing a character sheet
against a live conversation, or keeping help open while configuring a subsystem,
means navigating back and forth and losing context — including, for the Salon,
losing scroll position and draft text. Promoting Help, Brahma Console, and the
Wardrobe out of cramped modals into full tabs gives them room to breathe and
opens up layouts that modals can't support.

## Glossary

| Term | Meaning |
|---|---|
| **Workspace** | The whole tabbed shell, hosted at `/workspace`. |
| **Pane** | A vertical half of the workspace. There are at most two: **left** and **right**. With one pane, it fills the width. |
| **Tab** | One open surface (a Salon conversation, Aurora, Help, etc.). Belongs to exactly one pane. |
| **View** | The React component rendered inside a tab — the body of a former route page (`SalonView`, `AuroraView`, …). |
| **Active tab** | The visible tab within a pane. Each pane has its own active tab. |
| **Focused pane** | The pane that last received user interaction. New tabs opened from the left rail land here; defaults to **left**. |
| **Home tab** | The default tab showing the existing home dashboard. Always present when no other tabs are open. |
| **Left rail** | The slim vertical icon navigation (`LeftSidebar` / `collapsed-nav.tsx`): Projects, Files, Scriptorium, Characters, Photos, Scenarios, Chats. **One shared rail** to the left of both panes — not per-tab. Clicking an item opens/focuses a tab in the focused pane. |
| **Page toolbar** | The horizontal contextual strip **above a tab's content** that a surface injects controls into (e.g. the Salon's project links / token-cost summary). Distinct from the left rail. Becomes **per-tab**. |

## Core requirements

1. **Open one tab on launch** — the home dashboard.
2. **Open a tab on action** — starting/opening a conversation opens (or focuses)
   its Salon tab; opening Aurora/Prospero/Scriptorium/Settings/Help/Brahma/
   Wardrobe opens (or focuses) its tab.
3. **Two-pane split** — drag a tab to the left or right half to split the screen;
   drag it onto the other pane's tab strip to join that pane.
4. **Reorder** — drag tabs within a strip to reorder.
5. **Close** — tabs are closeable. Closing the last remaining tab leaves a single
   home tab in a single pane.
6. **Keep-alive** — switching tabs (or moving a tab between panes) must **not**
   unmount the tab's view. This is mandatory for the streaming Salon (see
   Constraints).
7. **Persistence** — open tabs, their pane assignment, order, active-tab per
   pane, and split state persist to **localStorage** and restore on reload.
8. **Selective dialog promotion** — Brahma Console becomes a tab; Wardrobe
   becomes a tab **only** from the left rail (the chat-scoped path stays a
   dialog); **Help stays a modal**. Terminal and Document Mode become
   chat-linked tabs. (Details below.)

## Constraints (must not violate)

- **SSE streaming is out of scope.** The Salon's streaming hooks
  (`useSSEStreaming`, `useMessageStreaming`) and the virtualized message list
  must not be modified. The tab system works *around* them by keeping the Salon
  subtree mounted. (`CLAUDE.md` standing rule.)
- **Inactive tabs stay mounted, hidden via CSS.** Never conditionally render
  (`{active && <View/>}`) — that unmounts. Use `display:none` / a `hidden`
  offscreen container so EventSource, scroll position, and draft state survive.
- **App Router conventions.** New route under `app/`; no `pages/`; no
  `middleware.ts`; async request APIs (`await cookies()`, Promise `params`).
- **No new native modules; no schema/migration** for the chosen persistence
  model (localStorage). No DDL.md change, no `prettify.ts` label.

## Architecture

### Route

A single client route `app/workspace/page.tsx` hosts the workspace. It renders
inside the existing `AppLayout` (left rail + footer stay), but **replaces the
single routed-page area** with the two-pane tab host.

The current `app/page.tsx` home dashboard content is extracted into a
`HomeView` component so it can be rendered both at `/` (unchanged for now) and as
the workspace's home tab.

### State model (the tab manager)

A new client store — `WorkspaceProvider` / `useWorkspace`
(`components/providers/workspace-provider.tsx`) — owns:

```ts
type PaneId = 'left' | 'right';
type TabKind =
  | 'home'
  | 'salon'        // payload: { chatId: string }
  | 'terminal'     // payload: { chatId: string; sessionId?: string }  — child of a salon tab (Ariel)
  | 'document'     // payload: { chatId: string }                      — child of a salon tab (Librarian)
  | 'aurora'
  | 'prospero'
  | 'scriptorium'
  | 'settings'     // payload: { tab?, section? }  (deep-link target)
  | 'files'
  | 'photos'
  | 'scenarios'
  | 'brahma'
  | 'wardrobe';    // payload: { characterId?: string }  — RAIL-opened only; NO chatId (see Wardrobe)

interface WorkspaceTab {
  id: string;            // stable uuid
  kind: TabKind;
  payload?: unknown;     // kind-specific (e.g. chatId)
  title: string;         // shown on the tab
  icon?: string;
  parentTabId?: string;  // for terminal/document: the salon tab they belong to
}
```

> **Note:** `help` is intentionally **not** a tab kind — Help stays a floating
> modal (see "Help stays a modal"). Terminal and Document are tab kinds but are
> **child tabs** bound to a parent Salon tab via `parentTabId` (see
> "Terminal & Document Mode as chat-linked tabs").
> Wardrobe is a tab kind **only** when opened from the left rail; the chat-scoped
> path keeps the existing dialog (see "Wardrobe: tab vs dialog").

```ts
interface WorkspaceState {
  tabs: Record<string, WorkspaceTab>;
  panes: {
    left:  { order: string[]; activeTabId: string | null };
    right: { order: string[]; activeTabId: string | null } | null; // null = unsplit
  };
  focusedPane: PaneId;  // last-interacted pane; new rail-opened tabs land here. Default 'left'.
  splitRatio: number;   // left pane fraction of width when split (e.g. 0.5). Persisted.
}
```

**Focused pane.** The workspace tracks which pane the user last interacted with
(`focusedPane`, default `'left'`). Clicking a tab, clicking inside a pane's
content, or opening a tab into a pane sets it. If the focused pane no longer
exists (e.g. the right pane was just closed), it falls back to `'left'`.

Actions: `openTab(kind, payload, { pane?, focus? })` — **`pane` defaults to
`focusedPane`** (which defaults to `'left'`), so tabs opened from the shared left
rail land in whichever pane the user last touched. De-dupes — opening a tab that
already exists focuses it (and switches `focusedPane` to its pane) instead of
duplicating. `closeTab(id)`,
`moveTab(id, toPane, toIndex)`, `reorderTab`, `setActive(pane, id)`,
`splitTo(id, pane)`, `unsplit()`. `closeTab` of the last tab resets to a single
home tab in the left pane and clears the right pane.

**De-dupe rule:** a Salon tab is identified by `chatId`; a Terminal/Document tab
by its parent `chatId` (one each per chat); Aurora / Prospero / Scriptorium /
Settings / Brahma / rail-Wardrobe are singletons (one tab each). Help is not a
tab.

### Rendering (keep-alive)

The workspace renders **every open tab's view at once**, positioned into its
pane, with only the active tab in each pane visible:

```tsx
// Pseudocode — all tabs mounted; inactive hidden, not unmounted.
{Object.values(tabs).map(tab => (
  <div
    key={tab.id}
    className={cn('qt-tab-pane', !isActiveInItsPane(tab) && 'hidden')}
    aria-hidden={!isActiveInItsPane(tab)}
  >
    <TabToolbarProvider tabId={tab.id}>
      <TabView tab={tab} />
    </TabToolbarProvider>
  </div>
))}
```

`TabView` switches on `tab.kind` to render the matching view component. Moving a
tab between panes re-parents it (or, simpler, keeps a flat mounted list and only
changes which CSS column it's positioned in) — either way the subtree instance
is preserved, so the Salon's EventSource never closes.

> Implementation note: re-parenting a live React subtree across DOM containers
> can remount it. Prefer a **flat, always-mounted list** of tab views whose
> CSS grid-column / visibility is driven by state, so no view ever changes its
> React parent. This is the safest way to honor the keep-alive constraint.

### View components (extracted from routes)

For each surface, extract the page body into a reusable view that takes its
identifying input as a prop instead of from route `params`:

| Tab kind | New view | Extracted from |
|---|---|---|
| `home` | `HomeView` | `app/page.tsx` |
| `salon` | `SalonView` ({ chatId }) | `app/salon/[id]/page.tsx` |
| `terminal` | `TerminalView` ({ chatId, sessionId }) | `app/salon/[id]/components/TerminalPane.tsx` (+ `useTerminalMode`) |
| `document` | `DocumentView` ({ chatId }) | `app/salon/[id]/components/DocumentPane.tsx` (+ `useDocumentMode`) |
| `aurora` | `AuroraView` | `app/aurora/` |
| `prospero` | `ProsperoView` | `app/prospero/` |
| `scriptorium` | `ScriptoriumView` | `app/scriptorium/` |
| `settings` | `SettingsView` ({ tab, section }) | `app/settings/` |
| `files` / `photos` / `scenarios` | respective views | their routes |
| `brahma` | `BrahmaConsoleView` | `components/brahma-console/BrahmaConsoleDialog.tsx` body |
| `wardrobe` (rail only) | `WardrobeView` | `components/wardrobe/wardrobe-control-dialog.tsx` body |

Help has **no** view — it stays a modal. Terminal/Document views reuse the
existing panes and chat-bound hooks; only their container changes from the
chat-internal `SplitLayout` to a workspace tab.

Data fetching (TanStack Query) moves with the view unchanged. **Do not touch the
Salon streaming hooks** — they ride along inside `SalonView`.

### Left rail (shared navigation — unchanged in spirit)

The existing slim left rail (`LeftSidebar` / `components/layout/left-sidebar/
collapsed-nav.tsx`) stays as **one shared rail** to the left of both panes,
rendered by `AppLayout` outside the pane host. It is **not** per-tab and does not
move when the screen splits.

Its only behavioral change: clicking a rail item calls
`openTab(kind, payload)` with **no explicit pane**, so the tab opens (or focuses,
if already open) in the **focused pane** — defaulting to the left pane on a fresh
split or first launch. Today these items are `<a href>` links into routes; they
become `openTab(...)` calls (the hrefs can remain as progressive-enhancement
fallbacks that the redirect layer resolves).

This keeps navigation in one familiar place while letting the user steer *which*
half a new surface opens into simply by clicking in that half first.

### Terminal & Document Mode as chat-linked tabs

Terminal Mode (Ariel) and Document Mode (the Librarian) are **not** separate
surfaces today — they are **modes of a Salon chat**. Their state lives **on the
chat record**: `terminalMode`, `activeTerminalSessionId`, document mode
(`normal` / `split` / `focus`), and divider positions
(`rightPaneVerticalSplit`, etc.). The chat currently renders them via an
internal `SplitLayout` (`app/salon/[id]/components/SplitLayout.tsx`) that splits
the chat pane in place.

**Decision: promote them to separate top-level workspace tabs that remain linked
to their parent chat.** Opening Terminal/Document mode for a conversation spawns
a sibling workspace tab (titles like `Terminal: <chat>` / `Document: <chat>`)
instead of splitting inside the chat.

Implementation details:

- **No schema change.** The mode state already lives on the chat record; a
  Terminal/Document tab is a *view* of that chat-bound state, not a new entity.
  `useTerminalMode({ chatId, chat })` and `useDocumentMode` keep their current
  chat binding.
- **Identity / de-dupe:** a Terminal tab is keyed by its parent `chatId`
  (a chat has at most one Terminal tab and one Document tab in the workspace at a
  time); re-invoking focuses the existing one. **One terminal tab per chat** is a
  deliberate cap — for multiple shells in one conversation, use a multiplexer
  (`tmux` / `screen`) inside the single session rather than multiple tabs. The
  `sessionId` in the payload identifies *which* session that single tab is bound
  to, not a license for parallel terminal tabs.
- **Parent linkage:** the tab carries `parentTabId` pointing at the Salon tab.
- **Lifecycle:** closing the parent **Salon** tab also closes its Terminal and
  Document child tabs (they're meaningless without their chat). Closing a child
  tab just toggles that mode off for the chat (persisted as today). A child tab
  can live in either pane — typically dragged to the opposite pane so the chat
  and its terminal/document sit side by side, which is exactly the layout the old
  internal split approximated, now with full workspace flexibility.
- **Keep-alive applies:** a live terminal PTY (Ariel) and an open document editor
  must survive tab switches — guaranteed by the always-mounted tab model. The SSE
  / PTY transports are untouched.
- **Retire the chat-internal split for these two.** With Terminal/Document as
  their own tabs, the Salon tab renders only the message stream; `SplitLayout`'s
  `split` / `focus` states are no longer needed *for terminal/document*. (If
  `SplitLayout` has no other consumers, it can be removed; verify before
  deleting.) The "focus" state — right pane full, chat hidden — is naturally
  replaced by simply viewing the Terminal/Document tab on its own.

> This is the largest behavioral change in the feature and should be its own
> implementation phase, sequenced **after** the basic Salon tab works.

### Dialogs are workspace-level

Modals/dialogs (Help, the chat-scoped Wardrobe, and any other dialog) are
**app-level overlays that hover over the entire workspace** — not scoped to a
single tab or pane. This already falls out of the architecture: their providers
(`HelpChatProvider`, `WardrobeDialogProvider`, etc.) live once at the layout
level, above the tab host, so their dialogs render over everything regardless of
which tab or pane is active. **Do not** scope a dialog's overlay to a pane; the
full viewport is available to it.

### Wardrobe: tab vs dialog

The Wardrobe provider already takes optional `characterId` + `chatId`; with a
`chatId` it renders the "wearing now" column (chat-aware), without it it's
browse/edit only.

**Decision:**

- **Opened from the left rail → a workspace tab** (`kind: 'wardrobe'`, no
  `chatId`). Roomy browse/edit; cannot change "wearing now" because it isn't
  chat-aware. Singleton tab.
- **Opened from a chat** (participant card / chat sidebar) → the **existing
  dialog**, passed `characterId` + `chatId`, so it shows the "wearing now" column
  and can change what the character is actively wearing in that conversation.

Both paths reuse the same underlying Wardrobe component
(`wardrobe-control-dialog.tsx` body); only the container differs (tab shell vs
app-level modal). Keep `WardrobeDialogProvider` for the chat-scoped dialog path;
add a `wardrobe` tab kind for the rail path. This behavior is settled.

The chat-opened dialog **hovers over the whole workspace**, not just its pane
(see "Dialogs are workspace-level"), so it has the full viewport to work with and
isn't constrained by a narrow split pane.

### Help stays a modal

Help is **not** promoted to a tab. It remains the floating modal
(`HelpChatProvider` + `HelpChatDialog`) precisely because it needs to **send the
user places** (`help_navigate(url: ...)`) and stay aware of where the user is
across navigation — a tab inside the same workspace navigation system would lose
that cross-context awareness and risk reloading. No change to Help's current
behavior; it simply isn't part of the tab/redirect system.

### Resizable pane split

The divider between the left and right panes is **draggable to resize**. Stored
as `splitRatio` (left pane's fraction of total width, default `0.5`), clamped to
sensible min widths per pane (reuse the spirit of the Chat Sidebar's
`MIN_CHAT_WIDTH` guard so neither pane becomes unusably narrow). Persisted to
localStorage with the rest of the workspace state. Dragging is keyboard-nudgeable
for accessibility (mirror the Chat Sidebar's `WIDTH_KEY_STEP` pattern).

### Chat Sidebar inside a pane

The Chat Sidebar is already resizable (240–560px) and collapsible to a
mini-avatar strip, with width/collapsed state in localStorage
(`quilltap.chat-sidebar.*`). It's wide, which is a problem in a split pane.

**Decision: auto-collapse only when the pane is narrow.** In a wide/full pane it
behaves exactly as today (manual resize/collapse). When its pane drops below a
width threshold (e.g. while split), it switches to an **overlay** that
auto-collapses to the mini strip on outside interaction — clicking elsewhere in
the Salon, another tab, or outside the sidebar collapses it; it overlays the chat
rather than squeezing it when expanded. This adapts to the available room without
changing the comfortable wide-pane experience. Reuse the existing collapse
mechanism; add the pane-width-aware trigger and the overlay positioning.

### Styling: `qt-*` classes and theme propagation

This feature adds real new chrome (a workspace tab strip, two panes, a draggable
pane divider, drop-zones, an overlay Chat Sidebar). Per the CLAUDE.md Themes
rule, **new visual surfaces use `qt-*` semantic classes, not raw Tailwind**, and
any significant `qt-*` change must propagate to the stylebook,
[theme-storybook](/packages/theme-storybook), possibly
[create-quilltap-theme](/packages/create-quilltap-theme), and **all six bundled
themes** (`themes/bundled/`: `art-deco`, `earl-grey`, `great-estate`,
`madmans-box`, `old-school`, `rains`). Each bundled theme has its **own take** on
these surfaces — a divider grip or active-tab treatment that reads as Art Deco
must also read correctly as Rains, Earl Grey, etc. Budget for "style it once per
theme," not "style it once."

**Reuse before inventing.** Relevant vocabulary already exists:

- **Tab strip** → extend the existing `qt-tab` family (`qt-tab`,
  `qt-tab-group`, `qt-tab-active`, `qt-tab-hover-*`, `qt-tab-divider`,
  `qt-tab-icon`, with tokens for padding/radius/font/bg/fg). The workspace tab
  strip should build on this rather than create a parallel system. New states it
  likely needs: a **close affordance**, a **drag/dragging** state, and a
  **dirty/streaming** indicator (e.g. a live conversation) — add these as
  `qt-tab-*` modifiers.
- **Pane divider** → reuse the existing `qt-doc-divider` / `qt-doc-vertical-
  divider` pattern (it already has `-active` and `-grip` variants powering the
  chat-internal `SplitLayout` resize). A new `qt-workspace-divider` should mirror
  that structure/tokens so theming is consistent and grips look intentional.
- **Panels/surfaces** → reuse `qt-panel` / `qt-panel-elevated` tokens for pane
  backgrounds and the tab strip surface.

**Genuinely new `qt-*` to add** (keep the namespace tidy and themeable):

- `qt-workspace` / `qt-workspace-pane` — the two-pane container and each pane.
- `qt-workspace-divider` (+ `-active`, `-grip`) — the resizable pane split.
- `qt-tab-strip` — the per-pane tab bar (if `qt-tab-group` isn't a clean fit).
- `qt-tab-close`, `qt-tab-dragging`, `qt-tab-drop-zone` (+ `-active`) — close
  button, drag state, and the split/join drop targets.
- `qt-chat-sidebar-overlay` — the narrow-pane overlay mode of the Chat Sidebar.

Define new tokens in `_variables.css`, the classes in the appropriate
`qt-components/*.css` (tab/strip → `_layout.css`; sidebar overlay → `_chat.css`),
add them to the stylebook, and give each bundled theme its own values.

### Page toolbar — per-tab (required refactor)

`PageToolbarProvider` is today a **global singleton** (one `PageToolbar` for the
whole app). This is the horizontal contextual strip above page content — **not**
the left rail. With two panes each showing different surfaces, the page toolbar
must be **per-tab**. Plan:

- Introduce `TabToolbarProvider` scoped to each mounted tab (same
  `leftContent`/`rightContent` API so the ~existing `usePageToolbar` call sites
  don't change shape).
- Render each pane's toolbar from its **active tab's** toolbar context.
- Keep `usePageToolbarOptional` working for views rendered outside a tab (e.g. the
  legacy `/` route during transition).

This is the most invasive part touching shared code; budget for it explicitly.

### Old routes → redirects

Demote the per-surface routes to redirects into the workspace, mirroring the
existing renamed-route redirects (`/foundry/*`, `/chats`, `/characters`,
`/projects`):

- `/salon` → open Salon list / most-recent, `/salon/[id]` → open Salon tab for
  that chat.
- `/aurora`, `/prospero`, `/scriptorium`, `/settings` (preserving `?tab=`/
  `&section=`), `/files`, `/photos`, `/scenarios` → open the matching tab.

The redirect target is `/workspace`; the intent (which tab to open) is passed via
a transient query param that the workspace consumes on mount and then strips, so
the resting URL is clean `/workspace`. **API paths are unaffected** — only UI
routes change.

In-app help deep-linking (`help_navigate(url: ...)`) is **unchanged** — Help
stays a modal, so it keeps its current navigate behavior and is not part of the
redirect/tab system.

### Persistence

Serialize `WorkspaceState` to `localStorage` (per instance key) on change
(debounced); hydrate on mount. On hydrate, **validate** that referenced entities
still exist (e.g. a persisted `chatId` whose chat was deleted) and drop dead
tabs, falling back to the home tab if everything is gone. No DB, no migration.

### Drag and split interactions

- Drag a tab within its strip → reorder.
- Drag a tab onto the **other pane's strip** → move it there (creates the right
  pane / split if it didn't exist).
- Drag a tab onto a pane's **center drop-zone** when unsplit → create the split
  and place the tab in the new pane.
- A pane with zero tabs collapses; if that empties the right pane, the layout
  returns to a single full-width pane.
- When split, a **draggable divider** between the panes resizes them
  (`splitRatio`), clamped to per-pane minimums; double-click resets to 0.5.
- Use an existing, dependency-light DnD approach consistent with the codebase
  (HTML5 drag events are sufficient; avoid pulling in a heavy DnD lib unless one
  is already present). The divider drag can mirror the Chat Sidebar's existing
  resize handler.

## Phased implementation

**Phase 0 — Scaffold (no behavior change).**
Add `app/workspace/page.tsx` behind a feature flag; build `WorkspaceProvider`
with state + actions and localStorage persistence; render a single home tab only.
Unit-test the reducer (open/close/move/split/unsplit, last-tab-reset, de-dupe).

**Phase 1 — View extraction.**
Extract `HomeView`, then `SalonView` (most care — streaming rides along),
`AuroraView`, `ProsperoView`, `ScriptoriumView`, `SettingsView`, and the
file/photo/scenario views. Keep the original routes rendering these views so
nothing breaks yet.

**Phase 2 — Per-tab toolbar.**
Introduce `TabToolbarProvider`; wire each pane's toolbar to its active tab; keep
`usePageToolbarOptional` for the legacy route. Verify toolbar content is correct
with two different surfaces side by side.

**Phase 3 — Multi-tab + split + drag + resizable divider.**
Render all open tabs kept-alive; implement the two-pane layout, active-tab per
pane, reorder, move-between-panes, split/unsplit drop-zones, the **draggable
divider** (`splitRatio`), close, and last-tab-reset.

**Phase 4 — Terminal & Document as chat-linked tabs.**
Promote Terminal Mode (Ariel) and Document Mode (Librarian) from the chat's
internal `SplitLayout` to sibling workspace tabs bound to their parent chat via
`parentTabId`; wire the parent-close cascade; retire `SplitLayout` for these two
(verify no other consumers before removing). This is the largest behavioral
change — sequence it after the basic Salon tab is solid.

**Phase 5 — Brahma tab + Wardrobe rail-tab + Chat Sidebar auto-collapse.**
Add `brahma` and rail-only `wardrobe` tab kinds (reusing the dialog bodies);
keep the chat-scoped Wardrobe **dialog** path (with `chatId`) intact. Add the
pane-width-aware auto-collapse/overlay to the Chat Sidebar. **Help is untouched
— it stays a modal.**

**Phase 6 — Redirects + cutover. (Done.)**
The old UI routes redirect to `/workspace` with an open-tab intent, the workspace
store lives app-level in `AppLayout`, and `/workspace` is the post-login landing
surface. The `WORKSPACE_TABS_ENABLED` flag now **defaults on** (set
`NEXT_PUBLIC_WORKSPACE_TABS=0` to opt out). Every route with a tab equivalent —
including the later editor/creator surfaces (character edit/new, image
generation, profile, about, the provider wizard) — redirects via
`redirectToWorkspaceTab(...)`, and `WorkspaceIntent` opens the matching tab.

Detail and list deep links joined the cutover later: `/salon` redirects to a
`salon-list` tab; `/prospero/[id]`, `/scriptorium/[id]`, and
`/aurora/groups/[id]` redirect to their singleton list tab carrying a drill-in
payload (`projectId` / `storeId` / `groupId`) that the view follows in place;
`/aurora/[id]/view` redirects to a `character-view` tab (with `?tab=`, and
`?action=chat` popping the new-chat modal); `/salon/new` redirects with an
`open=new-chat` intent that pops the new-chat modal; and
`/salon/[id]/terminal/[sessionId]` opens the conversation's Salon tab plus a
child terminal tab (the Salon view is the portal source for the live PTY). The
affected client pages split into server redirect wrappers plus `*PageClient`
legacy bodies for the flag-off path.

**Phase 7 — Theming pass (`qt-*` + all six bundled themes).**
Finalize the `qt-*` classes/tokens (reusing `qt-tab*` and `qt-doc-divider*`
where possible), add them to the stylebook and theme-storybook, update
`create-quilltap-theme` if the surface set changed, and give **each** bundled
theme (`art-deco`, `earl-grey`, `great-estate`, `madmans-box`, `old-school`,
`rains`) its own take on the tab strip, divider/grip, drop-zones, and sidebar
overlay. Verify each theme renders the split workspace correctly. (Theming can
start as soon as a surface stabilizes; this phase ensures none is left behind.)

**Phase 8 — Polish.**
Keyboard shortcuts (next/prev tab, close tab, split), empty-pane affordances,
overflow handling for many tabs, and persistence-validation edge cases.

## Testing strategy

- **Reducer unit tests** (Jest): every action, de-dupe, last-tab-reset,
  split/unsplit transitions, persistence round-trip, and dead-tab pruning on
  hydrate.
- **Keep-alive integration test:** open a Salon tab, switch to another tab and
  back, assert the `SalonView` instance was never unmounted (e.g. a mount-counter
  ref, or asserting EventSource was opened exactly once). This is the test that
  guards the core constraint.
- **Per-tab toolbar test:** two panes with different surfaces show distinct
  toolbar content.
- **Playwright E2E:** open conversation → new tab; drag to split; close last tab
  → home; reload → layout restored; old-route deep link → correct tab opens.
- **Type check** with `npx tsc` (not `npm run build`).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Tab switch unmounts the streaming Salon → SSE lost (violates standing rule). | Flat always-mounted tab list; CSS visibility only; mount-counter integration test guards it. |
| Re-parenting a tab between panes remounts its subtree. | Don't re-parent — change CSS grid-column/visibility; React parent never changes. |
| Per-tab toolbar refactor ripples across many call sites. | Keep the `usePageToolbar` API identical; only the provider scope changes. Phase 2 isolates it. |
| Many mounted tabs cost memory/CPU. | `display:none` halts layout/paint; cap practical tab count; lazy-mount a tab's view on first activation, then keep it. |
| Persisted tabs reference deleted entities. | Validate on hydrate; prune dead tabs (including orphaned terminal/document tabs whose chat is gone); fall back to home. |
| A live terminal PTY (Ariel) drops when its tab loses focus. | Same keep-alive guarantee as SSE — terminal tabs stay mounted; never touch the PTY/WS transport. |
| Orphaned Terminal/Document tab when parent chat tab closes. | Parent-close cascade closes child tabs; `parentTabId` makes the link explicit and testable. |
| Retiring `SplitLayout` breaks a non-terminal/document consumer. | Grep for all `SplitLayout` usages before removal; keep it if anything else depends on it. |
| New chrome styled with raw Tailwind → unthemed; or a theme left looking broken. | Use `qt-*` classes (reuse `qt-tab*` / `qt-doc-divider*`); the Phase 7 theming pass updates the stylebook, storybook, and **every** bundled theme, and verifies each renders the split workspace. |
| Big change destabilizes a release. | Feature-flagged through Phase 5; old routes keep working until Phase 6 cutover. |

## Out of scope (this release)

- URL-encoded shareable layouts (ADR Option C) — possible later, state model
  already accommodates it.
- DB-backed / cross-device layout persistence.
- More than two panes.
- Any change to SSE streaming.

## Documentation tasks (per CLAUDE.md, before commit)

- `docs/CHANGELOG.md` — plain-voice entry.
- `help/*.md` — new help doc for the workspace/tabs with `url` frontmatter and an
  "In-Chat Navigation" section whose `help_navigate(url: ...)` matches; update any
  help pages that describe single-page navigation.
- Update `.claude/commands/update-documentation.md` if new docs are added.
- User-facing strings (tab menus, drop-zone hints, empty-pane copy) in the
  steampunk / Roaring-20s / Wodehouse voice.

## Tasks

- [x] Phase 0: scaffold route, provider, reducer + tests, localStorage.
- [x] Phase 1: extract view components (HomeView, SalonView, …).
- [x] Phase 2: per-tab page toolbar (`TabToolbarProvider`).
- [x] Phase 3: multi-tab, two-pane split, drag, resizable divider, close, last-tab-reset.
- [x] Phase 4: Terminal & Document as chat-linked tabs; retire `SplitLayout` for them (workspace branch only — legacy route still uses it).
- [x] Phase 5: Brahma tab + Wardrobe rail-tab done (keep chat-scoped dialog); Help stays a modal. Chat Sidebar narrow-pane overlay done in Phase 8.
- [x] Phase 6: old-route redirects + app-level store + post-login landing; flag flipped on by default (`NEXT_PUBLIC_WORKSPACE_TABS=0` to opt out); every tab-equivalent route (including the editor/creator surfaces) redirects and `WorkspaceIntent` opens the matching tab.
- [x] Phase 7: single `--qt-workspace-accent` master token drives the active tab / divider / drop-zone; all six bundled themes set their own accent (teal/gold/blue/slate); the hard-coded Madman's Box override moved into the theme bundle; `@quilltap/theme-storybook` Workspace story + supporting CSS added; `create-quilltap-theme` bundle template documents the hook; bundled-theme + tooling versions bumped.
- [x] Phase 8: Ctrl/Cmd+Alt keyboard shortcuts (next/prev/jump/close/split, inert while typing); active-tab scroll-into-view for overflow; defensive empty-pane affordance; Chat Sidebar narrow-pane click-away overlay.
- [x] Docs: CHANGELOG, help (help/tabbed-workspace.md), update-documentation. (User-facing voice pass ongoing.)
