# Realtime interface updates — WebSocket push + shared clock

> **Status:** Implemented (2026-08-26). All six phases landed together; this document is kept as the
> design of record. Where the shipped code diverged from the plan, the deviations are recorded in
> §8 below.
> **Scope:** Everything in the interface that changes over time without the user doing anything — the toolbar queue chips, autonomous-room badges, task-queue lists, story-background refreshes, embedding-status watches, and the relative timestamps ("4m ago") sprinkled through the UI. Two distinct causes, two distinct mechanisms: **server state changing** (push it over a WebSocket) and **the clock advancing** (tick it locally — no server involved).
> **Prerequisite reading:** the terminal WS stack (`server.ts`, `lib/terminal/ws.ts`), the TanStack Query migration spec (`docs/developer/features/complete/tanstack-query-migration.md`), and `docs/developer/BACKGROUND_JOBS_CHILD.md`.

---

## 1. The feature in one paragraph

A single multiplexed WebSocket at `/api/v1/system/realtime/stream` carries tiny **invalidation hints** — never data — from the server to every connected tab: `{v: 1, topic: 'jobs'}`, `{v: 1, topic: 'chats', id: '…'}`. The client maps each topic onto `queryClient.invalidateQueries(queryKeys…)`, so the HTTP API remains the single source of truth for what the data *is*; the socket only says *when to look again*. Every polling site keeps its poll as a degraded-mode fallback (stretched or disabled while the socket is healthy), so a dropped connection costs latency, never correctness. Server-side, events originate at the chokepoints that already see every change: the job dispatcher's post-commit `dispatchInvalidations`, the queue-service enqueue funnel, the terminal-state transitions in the dispatcher, and the activity registry's parent-side counters. Separately — and first, because it needs none of the above — a shared `useNow()` ticker makes relative timestamps actually advance, replacing today's situation where "3m ago" strings only update when something else happens to re-render them.

## 2. Design decisions settled (do not re-litigate)

1. **Push invalidation hints, not data.** No second serialization schema to drift from the REST responses, no duplicated Zod, reconnect handling is "invalidate and refetch." The only full-payload streams are the ones that already exist and stay untouched: the terminal WS and the Salon's SSE (chat turns, `carinaAnswer`, tool runs, character generation — all request-scoped streaming, explicitly fenced off per the TanStack migration spec).
2. **One socket per tab, multiplexed by topic.** No per-feature endpoints, no per-feature connections. Browsers cap connections and every socket is another reconnect state machine.
3. **Broadcast-all, no subscription protocol (v1).** This is a single-user instance with at most a handful of tabs; events are ~40 bytes. Every event goes to every connected client, and the client ignores topics it has no live queries for (TanStack invalidation of an inactive key is already a no-op). A subscribe/unsubscribe protocol is a later optimization if ever needed — YAGNI.
4. **Server-side coalescing is mandatory, not optional.** An `EMBEDDING_REINDEX_ALL` sweep completes thousands of jobs; a memory-extraction batch commits dozens of writes. The bus debounces per topic(+id) with a trailing edge (~250 ms) so a storm becomes one event. Clients must tolerate both missed events (reconnect ⇒ invalidate everything) and duplicate events (invalidation is idempotent).
5. **Polling survives as the fallback.** Every migrated site keeps its poll wired but gated: `refetchInterval` becomes a function returning `false` (or a long interval) while the socket is connected, and the original cadence when it is not. The queue chips' "pulse on between-poll blips" logic (`startedByKind`) stays — it is exactly the missed-event insurance this design wants.
6. **Relative timestamps never touch the network.** "4m ago" goes stale because the *client's* clock advanced. That is a shared local ticker (`useNow`), not a realtime event. Phase 0 ships it independently.
7. **Auth is hardened once, in the upgrade dispatcher.** The terminal handler's current "a session-ish cookie exists" fallback (`lib/terminal/ws.ts:84-101`) is not copied into a second handler. One shared upgrade-auth helper validates the session cookie properly and both handlers use it.
8. **Topics mirror `lib/query/keys.ts` namespaces.** A topic string is (or maps 1:1 onto) a query-key namespace, so the client mapping table is boring and the "add an entity" checklist is one line in each of two files.

## 3. Architecture map (where things live today)

Paths repo-relative. Line numbers as of the commit this plan was written against.

**WS plumbing (existing, to generalize):**
- `server.ts:34-64` — the custom server's `upgrade` listener. Path-matches `/api/v1/terminals/[id]/stream`, lazy-imports the handler, and deliberately falls through for everything else so Next's own listener gets HMR/dev-RSC upgrades. `npm run dev`, `npm start`, and the standalone tarball all run this file (`package.json` scripts `dev`/`start`; the shell launches `standalone/server.js` → `server-impl.js`), so the socket exists in every deployment mode.
- `server.ts:13` — one `WebSocketServer({ noServer: true })`, reused for any number of upgrade paths. Shutdown drains `wss.clients` (`server.ts:79-82`).
- `lib/terminal/ws.ts` — the model to follow for a handler module: extract/validate, authenticate, subscribe, wire `message`/`close`/`error`.
- `scripts/build-standalone-overlay.mjs:72-79` — server bundle marks `./lib/terminal/ws` external and esbuilds it separately. **A new handler module needs the identical treatment or it works in dev and vanishes from the tarball** (this exact gap has bitten before — see the standalone-esbuild memory/bug history).

**Server-side change chokepoints (where events originate):**
- `lib/background-jobs/host/job-dispatcher.ts:364-365` → `dispatchInvalidations(writes)` (`:507`) — runs exactly once after a job's full write batch has committed, with the batch in hand, already deduping character/mount-point keys for local-cache invalidation. **This is the single best hook in the codebase: entity-level topics fall out of it nearly for free (Phase 5).**
- Job lifecycle transitions, for the `jobs` topic: enqueue funnels through `enqueueJob` (`lib/background-jobs/queue-service.ts:429`) and `enqueueMemoryExtractionBatch` (`:1042`); claim (PENDING→PROCESSING) via `claimNextJob` at `job-dispatcher.ts:171`; terminal transitions all pass through `handleChildJobResult` (`job-dispatcher.ts:216` → `markCompleted` `:237` / `markFailed` `:229/:247`) plus the child-unavailable `markFailed` at `:196`; cancel via `cancelJob` (`queue-service.ts:1146`).
- Non-job activity, also `jobs` topic: `beginActivity`'s span start/end (`lib/background-jobs/activity-registry.ts:109`) in the parent, and `applyChildActivityDelta` (`:183`) where the forked child's mirrored spans land. All of this already runs in the parent process — the same process that owns the sockets. The job child never needs to reach the socket; its changes arrive via the existing IPC (activity mirror + write batches).
- Badges read model: `GET /api/v1/system/jobs` (`app/api/v1/system/jobs/route.ts:29`) returning `{stats, activeByKind, startedByKind, processor}` via `getActivitySnapshot` (`queue-service.ts:1127`). Unchanged by this plan — it stays the source of truth the invalidated query refetches.

**Client query infrastructure:**
- `lib/query/keys.ts` — 28 namespaces. **`system` has no `jobs` key**; the queue chips currently bypass TanStack entirely (raw `fetch` + self-rescheduling `setTimeout`), which is why they can't participate in invalidation today.
- `lib/query/QueryProvider.tsx` — the top-level provider; the realtime hub mounts beside it.
- `hooks/useTerminalSession.ts` — the existing client WS lifecycle to crib from (30 s ping at `:101`).

**Current polling inventory (what Phases 3–4 retire or gate):**

| Site | Interval | Data | Phase |
|---|---|---|---|
| `components/layout/queue-status-badges.tsx:57-58,164` | 1.5 s active / 8 s idle, adaptive `setTimeout`, kicked by `quilltap:queue-change` window event | `GET /api/v1/system/jobs` | 3 |
| `components/layout/autonomous-room-badges.tsx:159` | 5 s | `queryKeys.system.autonomousRooms` | 4 |
| `components/tools/autonomous-rooms-card.tsx:76` | 5 s | same | 4 |
| `components/tools/tasks-queue/hooks/useTasksQueue.ts:22` | 5 s (user toggle) | `queryKeys.system.tasksQueue` | 4 |
| `hooks/useStoryBackground.ts:68,110` | 30 s passive; 5 s × 36 active loop | `?action=get-background` | 4 |
| `components/tools/memory-backfill-card.tsx:37` | 4 s | backfill progress | 4 |
| `components/tools/memory-regenerate-card.tsx:49` | 5 s while in flight | regen status | 4 |
| `components/tools/conversation-summary-regenerate-card.tsx:41` | 5 s while in flight | regen status | 4 |
| `components/character/character-conversations-tab.tsx:203,239` | 5 s, self-terminating | chat list, watching `scriptoriumStatus` → `embedded` | 4 |
| `app/salon/[id]/SalonView.tsx:220` | 5 s × 24 | chat detail, watching avatar URL | 4 |
| `components/loading/StartupProgress.tsx:46,112,181` | 1 s until settled | startup status | **stays polling** (runs during boot, before app infra is warm; bounded duration) |
| `hooks/useHealthCheck.ts:98` | 5 s singleton | `/api/health` | **stays polling** v1 (it exists to detect a dead server, which is the one thing a socket on that server can't report; optional later: socket-close triggers an immediate check) |

*Not server polls — untouched:* `session-provider.tsx` (300 s session refresh), `auto-lock-provider.tsx` (local idle check), `ProgressBar.tsx` (animation), `autonomous-room-badges.tsx:205` (1 s local budget tick — that's a Phase 0 clock, not a poll).

**Relative-timestamp surface (Phase 0):**
- `lib/format-time.ts:93` — `formatRelativeDate` ("Just now" / "{n}m ago" / "{n}h ago" / absolute). Consumers: `components/tools/tasks-queue/{index,TaskItem,TaskDetails}.tsx`, `components/chat/MergeConversationModal.tsx:263`.
- `lib/format-time.ts:121` — `formatChatListDate` (today→time, "Yesterday", weekday, date). Consumer: `components/chat/ChatCard.tsx:20`.
- `components/loading/StartupProgress.tsx:144` — a **second, incompatible** local `formatRelativeAge` with seconds granularity. Consolidate into `lib/format-time.ts`.
- (`lib/memory/memory-weighting.ts:163` has a same-named server-side prompt-text helper — different concern, leave alone.)
- **Nothing re-renders these on a timer today.** The only ticking component is the autonomous-room budget readout. `ChatCard` and `MergeConversationModal` go stale indefinitely; the tasks queue only refreshes while its 5 s poll toggle is on.

## 4. The design

### 4.1 Event envelope

`lib/schemas/realtime.types.ts` (client-safe, types + Zod only):

```ts
export const RealtimeEventSchema = z.object({
  v: z.literal(1),
  topic: z.string(),        // a queryKeys namespace name, e.g. 'jobs', 'chats', 'autonomousRooms'
  id: z.string().optional(),// entity id when the change is row-scoped
  at: z.number(),           // server ms timestamp (debugging/ordering only — clients must not depend on it)
});
```

Client→server messages: `{type: 'ping'}` only (answered `{type: 'pong'}`), mirroring the terminal protocol. No subscribe verbs in v1 (decision 3).

### 4.2 Server: the bus and the handler

- `lib/realtime/bus.ts` — a `globalThis`-backed singleton (same HMR-survival pattern as `activity-registry.ts`): `publish(topic, id?)`, an internal per-`topic:id` trailing-edge debounce (~250 ms, decision 4), and `attachSocket(ws)` / socket bookkeeping. Fan-out is "for each open socket, `ws.send`," swallowing per-socket send failures. Fires debug logs per the logging rule (publish, coalesce-drop, fan-out count, socket attach/detach).
- `lib/realtime/ws.ts` — the upgrade handler, structurally a twin of `lib/terminal/ws.ts` minus the PTY: authenticate via the shared helper (below), `bus.attachSocket(ws)`, wire `message` (ping only), `close`, `error`.
- `lib/realtime/upgrade-auth.ts` — **shared** upgrade authentication used by *both* the realtime and terminal handlers: parse the session cookie off the raw `IncomingMessage` and validate it against the real session store (what `getServerSession` does for route handlers), replacing the terminal handler's cookie-presence fallback. Reject with `1008`.
- `server.ts` — add one branch to the `upgrade` listener matching `/^\/api\/v1\/system\/realtime\/stream(\?|$)/`, lazy-importing `./lib/realtime/ws.js` exactly like the terminal branch (same `.js`-suffix ESM note). Keep the fall-through for Next's own upgrades. Add the module to the shutdown drain (already covered — one shared `wss`).
- **Publishing is always parent-process.** Handlers running in the job child never import the bus; their changes surface through the parent chokepoints in §3. If a future child path genuinely needs an ad-hoc event, it goes over the existing IPC as a message the parent republishes — never a new channel.

### 4.3 Client: the hub

- `lib/realtime/client.ts` — a module-level singleton WebSocket manager: connect on first use, exponential backoff with jitter on close (1 s → 30 s cap), 30 s ping (crib `useTerminalSession`), `document.visibilityState` awareness (don't thrash reconnects in hidden tabs), and a `connected` observable that components/`refetchInterval` functions can read.
- `lib/realtime/topic-map.ts` — the one mapping table: topic → query-key prefix. E.g. `jobs → queryKeys.system.jobs`, `autonomousRooms → queryKeys.system.autonomousRooms`, `chats → queryKeys.chats.all` (or `queryKeys.chats.detail(id)` when `id` present). Unknown topics are ignored with a debug log — an older client surviving a server upgrade must not break.
- `components/providers/realtime-provider.tsx` (mounted inside `QueryProvider`): subscribes the singleton to the query client. On event: `invalidateQueries` per the map. **On (re)connect: invalidate every mapped prefix** — the catch-up that makes missed events harmless.
- Fallback gating helper: `realtimeRefetchInterval(pollMs)` returning a function for `refetchInterval` — `false` while connected, `pollMs` otherwise.

### 4.4 What this is *not*

- Not a data channel. If a consumer needs pushed *payloads* (live token streams, PTY bytes), it uses the transports that exist for that.
- Not a replacement for the Salon SSE, the terminal WS, or `notifyQueueChange`'s same-tab kick (the window event stays useful for zero-latency local echo; it just stops being the only signal).
- No schema/DDL changes, no export-format impact, no migrations.

## 5. Phases

### Phase 0 — The shared clock (client-only; independent; can ship first)

1. `hooks/useNow.ts`: `useNow(granularityMs)` backed by **one** module-level timer per granularity with a subscriber set (not one interval per component). Ticks are boundary-aligned (fire just after each minute/second boundary) so every "4m ago" on screen flips to "5m ago" together. Components re-render only on their granularity's tick.
2. Consolidate `StartupProgress.tsx`'s local `formatRelativeAge` into `lib/format-time.ts` (seconds-granularity variant alongside `formatRelativeDate`).
3. Adopt in: tasks-queue `TaskItem`/`TaskDetails` (60 s), `MergeConversationModal` (60 s), `ChatCard` (`formatChatListDate` needs a *day-boundary* tick for the "Yesterday"/weekday rollover — a midnight-aligned granularity, cheap since it fires once a day), `StartupProgress` (1 s, replacing the incidental poll-driven refresh), and refactor `autonomous-room-badges`' bespoke 1 s `setNowMs` tick onto `useNow(1000)`.
4. Guard rail: `useNow` must be inert on the server (SSR) and must not wake hidden tabs at second granularity (pause fine-grained ticks when `document.hidden`, resync on visibility).

### Phase 1 — Server bus + endpoint

1. `lib/schemas/realtime.types.ts`, `lib/realtime/bus.ts`, `lib/realtime/upgrade-auth.ts`, `lib/realtime/ws.ts` as in §4.2.
2. `server.ts` upgrade branch.
3. Switch `lib/terminal/ws.ts` to the shared `upgrade-auth` helper (the auth hardening rides in with this phase).
4. **Standalone build:** in `scripts/build-standalone-overlay.mjs`, add `--external:./lib/realtime/ws` to the server-impl esbuild line and a second esbuild emitting `lib/realtime/ws.js`, mirroring the terminal pair at `:72-79`. Verify the tarball boots and serves the socket.
5. Debug logging throughout (bus + handler).

### Phase 2 — Client hub

1. `lib/realtime/client.ts`, `lib/realtime/topic-map.ts`, `realtime-provider.tsx`, `realtimeRefetchInterval` helper as in §4.3.
2. Add `queryKeys.system.jobs` to `lib/query/keys.ts` (needed by Phase 3; the namespace rule in that file's header applies).
3. Reconnect catch-up: on open, invalidate all mapped prefixes.

### Phase 3 — First consumer: the queue chips + `jobs` topic

1. Server: `publish('jobs')` from the chokepoints in §3 — `enqueueJob` / `enqueueMemoryExtractionBatch` / `cancelJob` (queue-service), `claimNextJob`-successful-claim, `markCompleted`, `markFailed` (job-dispatcher), and activity-registry span start/end + `applyChildActivityDelta`. The bus's debounce collapses the storms (a 30-job batch enqueue is one event).
2. Client: refactor `queue-status-badges.tsx` onto `useQuery(queryKeys.system.jobs)` + the hub, with `realtimeRefetchInterval` preserving the adaptive 1.5 s/8 s cadence as fallback. Keep the pulse-on-blip logic (`startedByKind` deltas) and the `quilltap:queue-change` local kick (now `invalidateQueries` instead of a bespoke re-poll).
3. This phase is the template PR: it exercises bus, handler, hub, mapping, fallback, and coalescing end to end on the most demanding consumer.

### Phase 4 — Retire the remaining pollers (one PR each, any order)

Per-site treatment (all keep gated fallback polling per decision 5):

- **Autonomous rooms** (`autonomous-room-badges`, `autonomous-rooms-card`): `publish('autonomousRooms')` from the run-state transition core (the unified start/resume/stop path — see the run-start-contract work) and from `AUTONOMOUS_ROOM_TURN` / `AUTONOMOUS_ROOM_SCHEDULE_TICK` job completion. The 1 s budget readout stays on `useNow` (Phase 0), not the socket.
- **Tasks queue** (`useTasksQueue`): already invalidation-shaped — just gate its `refetchInterval` and let the Phase 3 `jobs` events drive it. The user-facing auto-refresh toggle becomes "fallback polling on/off."
- **Story background** (`useStoryBackground`): `publish('chats', chatId)` / `publish('projects', projectId)` on `STORY_BACKGROUND_GENERATION` completion (falls out of Phase 5's `dispatchInvalidations` hook, or an explicit publish in Phase 4 if it lands first). Kills both the 30 s passive poll and the 3-minute active loop.
- **Memory backfill / regenerate / summary-regen cards**: driven by `jobs` events; their status endpoints just get invalidated instead of interval-fetched.
- **Character conversations tab** (embedding watch): driven by `mountPoints`/embedding-related events (Phase 5 entity topics; the coalesced `jobs` events are an adequate interim signal).
- **SalonView avatar watch**: `publish('chats', chatId)` on `CHARACTER_AVATAR_GENERATION` completion — replaces the 24-poll loop.
- **StartupProgress, useHealthCheck**: explicitly *not* migrated (see §3 table).

### Phase 5 — Entity topics from write batches

1. Hook `publish` into `dispatchInvalidations` (`job-dispatcher.ts:507`): it already walks the committed batch deduping entity keys — map repository targets → topics (+ids) and publish alongside the existing local-cache invalidation. One hook point covers every background-job write forever.
2. Parent-side (request-handler) mutations mostly don't need events — the tab that made the request already invalidates via `onSuccess`, per the TanStack conventions. Cross-*tab* freshness for user-initiated edits can ride the same `publish` calls added at repository/service chokepoints later, topic by topic, as wanted. This phase deliberately does **not** attempt blanket coverage of every write path — it opens the door and documents the pattern.
3. Checklist addition for future entities: new query-key namespace ⇒ consider a topic row in `topic-map.ts`.

## 6. Testing

- **Unit:** bus debounce/coalescing (fake timers), topic-map dispatch (unknown-topic tolerance), `useNow` boundary alignment + single-timer sharing (fake timers), upgrade-auth accept/reject.
- **Integration:** a `ws`-client test against the dev server exercising connect → publish → receive → reconnect-invalidate; terminal WS regression after the shared-auth switch.
- **Jest conventions apply** (global `jest`, bare mock factories); client hooks test through `renderWithQuery`.
- **Manual/standalone:** tarball boot + socket smoke test (Phase 1 step 4 is not done until this passes).

## 7. Risks & open questions

- **Next dev HMR coexistence:** the fall-through in `server.ts` is load-bearing; the new branch must match its path narrowly (regex anchored, as today) so dev-RSC/HMR upgrades keep flowing to Next.
- **Event storms beyond the debounce:** if a topic still chats too much (e.g. `jobs` during a huge reindex), the knob is the debounce window per topic — server-side, no client change.
- **Session-cookie validation on raw upgrades:** the shared helper needs the same cookie-parsing the route middleware uses; single-user mode keeps the stakes modest, but the point of doing it once is not having to think about it per handler.
- ~~Open~~ **Settled (2026-08-26):** the `tasks-queue` auto-refresh toggle survives as the fallback-poll switch, relabeled accordingly (see the Phase 4 tasks-queue item). Fallback polling in general is a keeper, not a transitional crutch — decision 5 stands as written.

---

## 8. What shipped, and where it diverged from this plan

Everything in §5 landed. The differences worth knowing:

- **`upgrade-auth` validates what there is to validate.** §4.2 called for validating "the session
  cookie against the real session store." There is no session cookie: Quilltap is single-user and
  `getServerSession()` resolves the instance's one user straight out of the database, cookie or no
  cookie. That is exactly why the terminal handler's cookie-presence fallback proved nothing, and it is
  now gone. The helper checks three things instead — a live session, not in locked mode, and
  **same-origin**. The origin check is the one that carries real weight: browsers do not apply CORS to
  WebSocket upgrades, so without it any page on any origin could open a socket against a localhost
  instance. A missing or `null` `Origin` is allowed (non-browser clients aren't the threat model).

- **A `memories` topic was planned and dropped.** `lib/query/keys.ts` has no memories namespace, so a
  topic naming one would have mapped to nothing. `REALTIME_TOPICS` ships with six: `jobs`,
  `autonomousRooms`, `chats`, `projects`, `characters`, `mountPoints`.

- **Phase 5's entity topics arrived with Phase 4, not after it**, because `topicsForCompletedJob`
  (job type + payload → hints) turned out to be the cheapest way to serve several Phase 4 consumers at
  once — the Salon's avatar watch and the story-background loop both need exactly that. The
  write-batch hook (`topicsForWriteBatch`, keyed on the repository namespace in a buffered write's
  `method` rather than on probing argument shapes) landed alongside it.

- **`useNow` gained an `enabled` flag.** Hooks can't be called conditionally, and the autonomous-room
  badges only want a second hand while a time-budgeted room is running. Disabled, it neither subscribes
  nor re-renders.

- **Two bespoke watches became declarative state** rather than stashed interval handles — the
  character conversations tab's Scriptorium watch and the Salon's avatar watch — because the push path,
  the fallback interval, and the timeout all need to read the same "is a watch active" answer. The
  single-chat Scriptorium watch also gained a five-minute expiry it never had: a render that never
  reached `embedded` used to poll forever.

- **The queue chips' adaptive cadence moved into `refetchInterval`'s function form**, reading
  `query.state.data` for the busy/idle decision, rather than a second timer racing the query's own.

- **The standalone `--external:./lib/realtime/ws` flag is belt-and-braces.** esbuild matches
  `--external` against the import path as written, and `server.ts` imports `./lib/realtime/ws.js` (with
  the suffix Node's ESM resolution requires), so the flag does not match and esbuild inlines the
  handler into `server-impl.js` — exactly as it has always done for `./lib/terminal/ws`. The separate
  bundle is still emitted, and the flag is kept for symmetry with the terminal pair. Because the bus
  keeps its state on `globalThis`, the inlined copy and the Next server bundle's copy share one socket
  set regardless.

- **`docs/developer/features/complete/tanstack-query-migration.md`'s fence held.** The Salon's SSE
  transport was not touched.

### Verified

Unit: bus coalescing, topic-map dispatch (including unknown-topic tolerance), `useNow` boundary
alignment and single-timer sharing, upgrade-auth accept/reject, the client hub's lifecycle, the
provider's invalidation mapping, and both job→topic mappings. Live, against a scratch instance: a
cross-origin upgrade refused with 1008, a same-origin upgrade accepted, ping answered with pong, a
`jobs` hint delivered on enqueue, twelve concurrent enqueues coalesced into one frame, the terminal WS
still serving after the shared-auth switch, zero background fetches in a 10 s idle window with the
socket up, and a clean reconnect after a server restart. The standalone overlay build emits
`lib/realtime/ws.js`.
