# ADR-0001: Tabbed workspace routing model

- **Status:** Proposed
- **Date:** 2026-06-21
- **Target release:** 4.8.0
- **Deciders:** Charlie (+ Claude Code on execution)
- **Related:** [Tabbed workspace feature spec](../features/tabbed-workspace.md)

## Context

Today every primary surface in Quilltap is a Next.js App Router route under
`app/`: the Salon (`/salon`, `/salon/[id]`), Aurora (`/aurora`), Prospero
(`/prospero`), the Scriptorium (`/scriptorium`), Settings (`/settings`), and so
on. A single client shell — `components/layout/app-layout.tsx` (`AppLayout`) —
wraps the routed page with a collapsed left rail (`LeftSidebar`), a single
global `PageToolbar`, and the footer. Navigating between surfaces is ordinary
link navigation: the App Router unmounts the current page subtree and mounts the
next one.

Help, the Brahma Console, and the Wardrobe are **not** routes — they are modal
dialogs layered over the shell via context providers
(`HelpChatProvider` + `HelpChatDialog`, `BrahmaConsoleProvider` +
`BrahmaConsoleDialog`, `WardrobeDialogProvider` + `WardrobeControlDialog`).

We want a **tabbed workspace** that can split into two side-by-side panes
(left/right), where:

- the app opens with one tab (the home dashboard);
- starting a conversation opens a new tab for it;
- tabs can be dragged between the left and right halves to split or rejoin;
- tabs can be closed, and closing the last tab returns to a single home tab;
- Help, the Brahma Console, and the Wardrobe can be promoted from modals to
  full tabs.

### The load-bearing constraint

The Salon conversation view holds **live SSE streaming state**: `useSSEStreaming`,
`useMessageStreaming`, a virtualized message list, composer draft text, and
pending tool-call state (`app/salon/[id]/`). Per the standing rules in
`CLAUDE.md`, **the SSE streaming transport is out of scope and must not be
migrated or touched.**

A tab UI implies switching *away* from a streaming conversation and back. If the
conversation's React subtree unmounts on tab switch, the EventSource closes and
we lose the stream, scroll position, draft message, and tool-call state — and we
would be forced to touch the streaming layer to recover, violating the standing
rule. Therefore **a tab's content subtree must stay mounted while the tab is
inactive** (hidden via CSS, not unmounted). This is the single requirement that
dominates the routing decision.

## Decision

**Collapse the primary surfaces into a single client-owned workspace route
(`/workspace`) that renders kept-alive tab subtrees, and demote the old
per-surface routes to redirects that open the corresponding tab.**

Concretely:

- A new route `app/workspace/page.tsx` hosts a **tab manager** that owns the set
  of open tabs, their assignment to the left/right pane, the active tab per
  pane, and the split state.
- Each tab maps to a **view component** extracted from the existing route's page
  (e.g. a `SalonView`, `AuroraView`, `ProsperoView`). View components are the
  page bodies with their data-fetching intact, minus the `app/.../page.tsx`
  server-route wrapper.
- **All open tab subtrees render simultaneously**; inactive ones are hidden with
  CSS (`hidden`/`display:none` or an `inert` offscreen container), never
  unmounted. This satisfies the keep-streaming-alive constraint without touching
  SSE.
- The old routes (`/salon`, `/salon/[id]`, `/aurora`, `/prospero`,
  `/scriptorium`, `/settings`, …) become thin redirects to `/workspace` that
  pass an intent ("open Salon tab for chat `abc`") so deep links and bookmarks
  keep working. This mirrors the existing redirect pattern already used for the
  renamed routes (`/foundry/*`, `/chats`, `/characters`, `/projects`).
- Tab layout is persisted to **localStorage**, not the URL and not the database.
  The URL stays at `/workspace`; deep links resolve through the redirect layer.

This is the "Option B" referenced during design.

### Scope refinements (decided during design)

- **Help stays a modal**, not a tab — it must send the user places
  (`help_navigate`) and stay context-aware across navigation; a tab inside the
  workspace navigation would lose that and risk reloading.
- **Terminal Mode (Ariel) and Document Mode (Librarian)** — today *modes of a
  chat* rendered via the chat-internal `SplitLayout`, with state on the chat
  record — become **chat-linked child tabs** (`parentTabId` → Salon tab). No
  schema change; closing the parent chat tab cascades to its child tabs; the
  chat-internal split is retired for them.
- **Wardrobe** is a tab when opened from the left rail (no `chatId`, browse/edit
  only) and **stays a dialog** when opened from a chat (with `chatId`, so it can
  change "wearing now"). Both reuse the same component body.
- **Brahma Console** becomes a singleton tab.
- The **left/right pane divider is resizable** (`splitRatio`, persisted), and the
  **Chat Sidebar auto-collapses/overlays only when its pane is narrow**.

## Options considered

### Option A — Tabs as an overlay on the existing routes (keep file-based routing)

Keep each surface as its own route and fake kept-alive tabs using App Router
**parallel routes** and **intercepting routes**, so a tab can stay mounted while
another route is shown.

- **Pros:** URLs remain "native" per surface; least disruption to the route
  tree; deep linking is automatic.
- **Cons:** App Router unmounts on navigation by design. Parallel/intercepting
  routes can keep a *fixed, known* set of slots alive, but they map poorly to an
  **arbitrary, user-defined** number of tabs split across **two** panes with
  drag-between-panes. The machinery gets complex fast and still risks
  unmounting the streaming Salon subtree on certain transitions — the exact
  failure the constraint forbids. High risk against the one rule we cannot break.

### Option B — Single `/workspace` route with a client tab model (chosen)

Collapse surfaces into one route; render tabs as kept-alive view components;
redirect old routes.

- **Pros:** Directly satisfies the keep-streaming-alive constraint (we control
  mount lifecycle, not the router). Clean model for N tabs across two panes with
  drag/split/close. Help/Brahma/Wardrobe become tabs trivially (they're already
  self-contained components). Old routes still work via redirects.
- **Cons:** More upfront work: extract view components from routes, make the
  page toolbar per-tab, build the tab/pane state machine and drag interactions.
  URLs no longer change per surface (mitigated by redirects + optional future
  URL-encoding if we ever want shareable layouts).

### Option C — URL encodes the full layout

One `/workspace` route, but the querystring encodes which tabs are open in each
pane (`/workspace?left=salon:abc,aurora&right=help`).

- **Pros:** Exact layouts are shareable and bookmarkable.
- **Cons:** Constant URL↔state re-sync, history churn on every drag/close, and
  significant added complexity for a single-user, self-hosted app where
  shareable layouts have little value today. Rejected for 4.8.0; the state model
  is built so this could be layered on later without rework.

## Consequences

### Positive

- Live conversations survive tab switches and the two-pane split with no change
  to the SSE layer.
- Help, Brahma Console, and Wardrobe gain full-tab modes, unlocking the richer
  layouts that motivated the change.
- A single shell owns layout; per-surface routing logic shrinks to redirects.

### Negative / costs

- `PageToolbarProvider` (the horizontal contextual strip above page content, not
  the left rail) is currently a **global singleton** (one toolbar for the whole
  app). It must become **per-tab**, so each tab carries its own toolbar content.
  This is a real, bounded refactor touched by every surface that injects toolbar
  content. The slim **left rail** stays a single shared element to the left of
  both panes; its only change is that clicking an item opens/focuses a tab in the
  last-focused pane (default left) rather than navigating a route.
- View components must be extracted from route pages without disturbing their
  data fetching (TanStack Query) or, for the Salon, the streaming hooks.
- Rendering every open tab simultaneously raises baseline memory/CPU; mitigated
  by hiding inactive tabs (`display:none` halts layout/paint) and capping
  practical tab counts.

### Neutral

- Persisting to localStorage means **no schema change and no migration** — no
  DDL.md update, no `prettify.ts` loading-screen label. Layout is browser-local
  and resets if storage is cleared. Promoting to DB persistence later is a
  separate, additive decision.
- The single-user assumption holds; no auth/session implications.

## Compliance notes (standing rules)

- **SSE streaming untouched** — satisfied by the keep-mounted requirement.
- **App Router conventions** — new route under `app/`; no `pages/` dir; no
  `middleware.ts`; async request APIs preserved in any server bits.
- **Redirects** follow the existing renamed-route redirect pattern.
- **No migration** needed for the chosen persistence model.

## Follow-ups

- Revisit Option C (URL-encoded layouts) only if shareable/bookmarkable exact
  layouts become a real need.
- Revisit DB-backed persistence if cross-device/instance layout restore is
  wanted.
