# Native Core: API Boundary & Enclave Seam (Design Sketch)

> Status: exploratory design sketch for the next-generation native Quilltap
> (`foundry-9/quilltap`). Not a committed plan. Records the two decisions that
> must be right *early* — the Rust core's transport-agnostic API boundary, and
> the enclave engine's host-lifetime seam — because both are expensive to
> retrofit and cheap to get right up front.

## Target stack (context for this doc)

- **Core:** Rust. SQLCipher via `rusqlite` (`bundled-sqlcipher-vendored-openssl`),
  statically linked. Owns the data, the memory subsystem, job orchestration,
  and the single-writer invariant.
- **Front end:** Angular 21+ (zoneless, signals, standalone) SPA inside a
  **Tauri 2** webview.
- **Desktop:** ships first, fully production-grade.
- **Mobile (later):** same Angular UI via Tauri-mobile if it matures enough;
  otherwise native Swift/Kotlin shells over the *same* Rust core via `uniffi`.

The whole point of this doc: **build the core so it does not know or care which
of those three front ends is calling it.** Get that boundary right and the
mobile decision becomes a packaging choice, not a rewrite.

---

## Part 1 — The transport-agnostic API boundary

### The mistake to avoid

The tempting shortcut is to wire Angular straight to Tauri `#[command]`
functions and let those functions reach into the core's internals. That couples
your UI contract to Tauri's IPC, and the day you want a native iOS shell (which
calls Rust through `uniffi`, *not* Tauri IPC) or a thin HTTP shim for debugging,
you re-implement every call site. Don't. Put one boundary in the middle that all
three transports share.

### Three layers, one contract

```
┌──────────────────────────────────────────────────────────────┐
│  TRANSPORTS  (thin, swappable, no business logic)             │
│                                                               │
│  Tauri IPC adapter      uniffi adapter        HTTP adapter    │
│  (#[command] fns)       (Swift/Kotlin)        (axum, dev/CI)  │
│        │                     │                      │         │
│        └─────────────────────┼──────────────────────┘         │
│                              ▼                                │
├──────────────────────────────────────────────────────────────┤
│  CORE API  (the one boundary — the contract everyone calls)   │
│                                                               │
│  trait QuilltapCore {                                         │
│     async fn dispatch(&self, req: Request) -> Response;       │
│     fn subscribe(&self) -> EventStream;   // server-push      │
│  }                                                            │
├──────────────────────────────────────────────────────────────┤
│  ENGINE  (services, repos, the single writer, the job runner) │
│   chat orchestrator · memory gate · enclave engine · doc store│
└──────────────────────────────────────────────────────────────┘
```

The **Core API** is the load-bearing line. Above it: transports so thin they
contain no decisions, only marshalling. Below it: everything that is actually
Quilltap. Each transport's whole job is "turn a platform-native call into a
`Request`, hand it to the core, turn the `Response`/events back into something
the platform understands."

### Shape the contract as request/response + event-stream, not RPC-per-feature

Mirror what you already have. Today's Next.js API is the action-dispatch pattern
(`?action=favorite`) and the job IPC is a small enumerated message set
(`job` / `invalidate` / `shutdown` / `shutdown-ack` / `host-rpc` /
`host-rpc-response` one way, `job-result` / `log` / `status` / `host-rpc` back —
see `lib/background-jobs/ipc-types.ts`). Keep that
instinct. A *small, enumerated* message surface is far easier to expose
identically across three transports than hundreds of individually-typed RPC
methods — and `uniffi` in particular is happiest with a contained set of
serializable types rather than a sprawling API.

```rust
// Two enums and two structs are the entire cross-transport contract.

pub enum Request {
    SendChatMessage { chat_id: Uuid, body: String, /* … */ },
    ListCharacters  { project_id: Option<Uuid> },
    SelfInventory   { character_id: Uuid },
    StartEnclave    { room_id: Uuid, budget: EnclaveBudget },
    PauseEnclave    { room_id: Uuid },
    // … one variant per user-meaningful operation
}

pub enum Response {
    Ack,
    Characters(Vec<CharacterDto>),
    Inventory(SelfInventoryReport),
    Error(CoreError),
    // …
}

// Server-push: streaming tokens, the Staff's announcements, enclave turns,
// Carina answers — everything the current SSE layer carries.
pub enum Event {
    ChatToken     { chat_id: Uuid, delta: String },
    StaffMessage  { chat_id: Uuid, sender: SystemSender, body: String },
    EnclaveTurn   { room_id: Uuid, turn: TurnDto },
    CarinaAnswer  { chat_id: Uuid, /* … */ },
    JobStatus     { /* … */ },
}
```

Why this survives all three transports:

- **Tauri:** `dispatch` becomes one `#[command] async fn`; `Event` maps to
  Tauri's event emitter (`app.emit`). Angular calls `invoke('dispatch', req)`
  and listens with `listen('quilltap://event', …)`.
- **uniffi:** `Request`/`Response`/`Event` are `#[derive(uniffi::Enum/Record)]`;
  `dispatch` is an `async` exported function; the event stream becomes a
  callback-interface (`uniffi::export(callback_interface)`) that Swift/Kotlin
  implement. **The DTOs you defined for Tauri are reused verbatim** — that's the
  payoff. No second contract.
- **HTTP (axum):** trivially, `dispatch` behind `POST /api/dispatch`, events
  over SSE or websocket. Invaluable for CI, scripting, and Playwright-style
  end-to-end tests that never touch a webview.

### Where streaming lives

Your current architecture already treats the Salon's SSE stream as a special,
don't-touch transport. Preserve that boundary here: `dispatch` is for
request/response; **streaming is always the `Event` channel**, never a return
value. This keeps token streaming, Staff announcements, and Carina answers on
one uniform push path that each transport implements once. (It also means the
"opaque vs transparent character" filtering — which Staff events a character may
see — is enforced *in the core* before an `Event` is emitted, not re-implemented
per front end.)

### Angular's side of the seam

Wrap the transport in exactly one Angular service so no component ever imports
Tauri (or, later, a uniffi binding) directly:

```typescript
@Injectable({ providedIn: 'root' })
export class CoreClient {
  // Behind this service: invoke() on Tauri today; could be a uniffi-bridge
  // or fetch() tomorrow. Components never know which.
  async dispatch<T>(req: Request): Promise<T> { /* invoke('dispatch', req) */ }

  // Events surfaced as signals — the idiomatic Angular 21 way.
  readonly chatTokens = signal<ChatToken | null>(null);
  readonly staffMessages = signal<StaffMessage | null>(null);
}
```

This is also exactly where Angular's DI earns its keep over React for your
taste: `CoreClient` is one injectable seam, swappable in tests with a fake, and
the zoneless/signals model maps cleanly onto an event stream pushing into
signals. No `useEffect` subscription dance.

### The rule, stated once

> No business logic above the Core API line. A transport may marshal, validate
> shape, and translate errors. The moment a transport wants to *decide*
> something, that decision belongs in the engine, behind `dispatch`.

If you hold that line, adding the iOS shell later is: write a uniffi adapter,
write a Swift UI (or reuse the Angular one through Tauri-mobile). The core and
its contract do not move.

---

## Part 2 — The single-writer invariant, upgraded

Today the "parent process is the only DB writer" rule is enforced by *discipline
plus runtime machinery*: a forked child holds a readonly connection, buffers
writes into `AsyncLocalStorage`, ships them over IPC as `{ method, args }[]`,
and the parent applies them partitioned-by-database in hand-driven
`BEGIN IMMEDIATE` transactions. That entire apparatus exists to work around
Node's threading model.

**In Rust, most of it dissolves into the type system.** You don't need a
separate process to protect the writer; you need a type only one owner can hold.

```rust
/// The sole holder of the RW SQLCipher connection. Not Clone. Lives on one
/// dedicated writer task. Everyone else gets a read pool + a command sender.
pub struct Writer { conn: rusqlite::Connection /* SQLCipher, RW */ }

/// Cloneable, shareable read handle. Hands out readonly connections.
#[derive(Clone)]
pub struct ReadPool { /* r2d2 pool of readonly SQLCipher conns */ }

/// What everyone holds. Reads go direct; writes are sent to the writer task.
#[derive(Clone)]
pub struct Db {
    reads: ReadPool,
    writes: mpsc::Sender<WriteBatch>,  // the only way to mutate
}
```

The "parent is the only writer" invariant becomes "only the writer task owns the
`Writer`, and the *only* way to reach it is the `mpsc` channel." The compiler
enforces what was previously a documented discipline. Heavy jobs
(`MEMORY_HOUSEKEEPING` on a 20k-memory character — the original reason for the
child process) run on a `tokio` blocking-pool task and *cannot* stall chat,
because they were never on the request path's thread to begin with.

What you keep from the current design, because it was right:

- **Per-database partitioning.** Still three connections (main, mount-index,
  llm-logs); still commit each partition in its own transaction so one can't
  roll back another. This is a correctness property, not a Node workaround —
  port it directly.
- **Main-primary vs idempotent ordering.** The `AUTONOMOUS_ROOM_TURN`
  "commit main first, secondaries best-effort" rule and the idempotent-handler
  "secondaries first" rule are domain decisions. They live in the writer task's
  apply logic unchanged.
- **Folder-conflict remap.** The concurrent `docMountFolders.create` unique-index
  dance still applies; serialize batch-apply on the writer task (it's naturally
  serial — one task, one channel) and the remap logic ports as-is.

What you *delete*: the readonly-proxy, the `AsyncLocalStorage` write buffer, the
`{ method, args }` reflection, the child-unsupported-method throws, the host-RPC
round-trips for `uploadFile`/avatar/background writes (now just direct calls on
the writer task), and the whole crash-respawn-the-child policy. That is a large
amount of subtle machinery retired in exchange for one ownership rule.

---

## Part 3 — The enclave seam (the one mobile actually threatens)

Autonomous rooms are the feature that does **not** survive a naïve port to
mobile, and the reason is platform law, not language: iOS `BGTaskScheduler`
grants ~30-second windows every 15+ minutes, and a force-quit kills all
background work. "Characters converse overnight while you sleep" assumes an
always-on host. A phone is not one.

So the seam to get right now is: **the enclave engine must never assume it owns
a long-lived host.** Make host-lifetime a capability the engine is *granted*,
not one it presumes.

### Model an enclave run as a resumable state machine, not a loop

Your current code is already partway here, which is encouraging: the
autonomous-room work is split across `autonomous-run-start` (flip to `running`,
enqueue the first turn), `autonomous-room-turn` (drive exactly one turn, then
*self-re-enqueue* the next — note: not a wall-clock loop), `autonomous-room-
schedule-tick` (cron-driven due-room scan), and `autonomous-room-announce`
(lifecycle banners + the halfway/near-end/grace milestones). The turn handler is
the sole `MAIN_PRIMARY_JOB_TYPES` member precisely because each turn is a
non-idempotent committed unit. That self-re-enqueue-per-turn shape is already
close to `step()`; the native version makes the seam explicit rather than
implicit-in-the-queue.

Today an autonomous run is effectively driven by per-turn self-re-enqueue on an
always-up host. Re-model it as a persisted state machine whose every transition
is a single committed turn:

```rust
pub enum RunState {
    Scheduled { at: Timestamp },
    Running   { turn: u32, budget_left: Budget, next_speaker: Uuid },
    Paused    { reason: PauseReason },   // budget, host-sleep, user
    Concluding{ grace_turn_used: bool }, // your existing near-end grace turn
    Done      { outcome: Outcome },
}

/// One turn = one pure transition. No assumption about who calls it or when.
async fn step(core: &Engine, room_id: Uuid) -> StepResult { /* … */ }
```

`step` advances exactly one turn and commits (it's the `AUTONOMOUS_ROOM_TURN`
main-primary batch from Part 2). It does not loop. It does not care whether the
next `step` comes in 50ms or 6 hours. **A "driver" decides cadence, and the
driver is a per-host capability:**

| Host | Driver | Enclave behaviour |
|------|--------|-------------------|
| Desktop (Tauri) | tight `tokio` loop, your current behaviour | overnight runs work as they do today |
| Server companion (optional, axum) | same tight loop | the *real* answer for long overnight runs on behalf of mobile |
| iOS/Android (Tauri-mobile or native) | `step` once per granted background window; persist; yield | run advances opportunistically; **resumes on next app open** |

Because `step` is resumable and every turn is already committed, the iOS story
becomes honest: "your enclave advanced three turns overnight in the background
windows iOS allowed, and finished the rest when you opened the app" — or, if you
stand up the optional companion server, "your phone handed the run to your
desktop/server, which finished it." Either is a *driver* swap. The engine, the
budgets (turns/tokens/wall-clock/spend/daily-cap), the Host's halfway/near-end
pacing milestones, the grace turn, the memory provenance tagging
(`autonomous_room` vs overheard) — all unchanged.

### The rule, stated once

> The enclave engine exposes `step()` and a persisted `RunState`. It never
> sleeps, never loops on a wall clock, never assumes the process outlives the
> turn. Cadence is injected by a host-specific driver. Porting to a new host =
> writing a new driver, nothing else.

This is the single design choice that turns "enclaves don't work on iOS" from a
feature you lose into a feature that *degrades gracefully and documents itself*.

---

## What to lock in now vs defer

**Lock in now (expensive to retrofit):**

1. The `Request`/`Response`/`Event` contract as the one boundary; transports
   strictly thin. No business logic above the line.
2. Streaming only ever on the `Event` channel.
3. `Db` ownership model (writer-task-owns-`Writer`, channel is the only mutator),
   per-database partitioning preserved.
4. Enclave as `step()` + persisted `RunState` + injected driver.

**Safe to defer (cheap to add behind the boundary):**

- The uniffi adapter and any native mobile UI — until Tauri-mobile's maturity is
  proven or disproven for your needs.
- The optional companion server — only if/when overnight-on-mobile demand is real.
- Which Rust web/UI niceties (axum HTTP shim) you build for CI first.

If the four "lock in now" items hold, every later decision — desktop-first,
mobile-via-Tauri, mobile-via-native, server-assisted enclaves — is an additive
change behind a stable line, not a rewrite through it.
