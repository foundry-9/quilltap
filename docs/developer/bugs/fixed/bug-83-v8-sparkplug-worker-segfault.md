# Bug 83 — a V8 GC race kills a jest worker and fails an arbitrary suite

| | |
|---|---|
| **Status** | **Fixed in v4** (worked around; the defect itself is upstream V8's) |
| **Found** | 2026-08-20 (endemic long before that — the crash signature appears in session logs at least back to 2026-08-11, misattributed the whole time) |
| **Fixed** | 2026-08-20 |
| **Severity** | Medium — no user data at risk, but roughly **1 full `npm run test:unit` run in 5** on the macOS arm64 dev machine lost a worker and failed one suite. Worse than the wasted rerun is the trained reflex: "red suite? run it again" is exactly the habit that lets a *real* intermittent failure slide by unexamined |
| **Who it bites** | anyone running the jest suites on Node 24+ (the current engines floor). Reproduced upstream on macOS arm64; the defect is in shared V8 code, so other platforms are presumed exposed |
| **Provenance** | Not this codebase's at all. V8 13.6 (Node 24) has a GC race — [nodejs/node#62393](https://github.com/nodejs/node/issues/62393), Chromium issue 483731079. Still reproduces upstream on Node 26.7.0, so waiting out a Node upgrade was not an option |
| **Fix site** | `package.json` (the five jest scripts now launch `node --no-sparkplug node_modules/jest/bin/jest.js`), `jest.global-setup.js` (`armSparkplugGuard()` appends `--no-sparkplug` to `process.execArgv` before any worker forks), `jest.integration.config.ts` (now wired to the same globalSetup) |
| **Defect site** | upstream: `v8::internal::ClearStaleLeftTrimmedPointerVisitor::VisitRootPointers` dereferencing a junk slot of an `InternalFrame` mid-`Builtins_BaselineOutOfLinePrologue` |
| **v5 status** | Nothing owed — the Rust core doesn't run V8. The workaround should ride along only as long as v4's jest suites do |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-20)** — by disabling V8's Sparkplug baseline compiler for
every jest process, at two chokepoints so no invocation style escapes:

1. The five jest scripts in `package.json` (`test:all`, `test:coverage`,
   `test:integration`, `test:unit`, `test:watch`) launch jest as
   `node --no-sparkplug node_modules/jest/bin/jest.js`. (`NODE_OPTIONS` can't
   carry the flag — it's not on Node's allowlist — hence the explicit
   interpreter invocation.) jest-worker forks each worker with the parent's
   `process.execArgv`, so the flag propagates to the whole fleet, and the main
   process — which runs the tests itself under `--runInBand` or a single-file
   run — is covered directly.
2. `jest.global-setup.js` (`armSparkplugGuard()`) appends `--no-sparkplug` to
   `process.execArgv` when absent. `process.execArgv` is a plain mutable array
   that jest-worker reads at fork time, and globalSetup runs in the main
   process before any worker forks — so ad-hoc invocations that skip the npm
   scripts (`npx jest`, `npx jest -u some.test.ts`) still get protected
   workers. The integration config now points at the same globalSetup, which
   also brings it the native-ABI self-heal it never had.

## Symptom

Intermittently — about 1 full unit run in 5 locally — a run ends:

```
FAIL __tests__/unit/<some suite>.test.ts
  ● Test suite failed to run
    A jest worker process (pid=NNNNN) was terminated by another process:
    signal=SIGSEGV, exitCode=null.
```

with **every individual test in the run passing**. A *different* suite fails
each time — plugin tests, component tests, API tests — because the dying worker
takes down whatever file it happens to hold. A rerun essentially always passes,
which is what kept this filed under "flake" instead of "bug" for months.

## Root cause

A V8 13.6 garbage-collection race, [nodejs/node#62393](https://github.com/nodejs/node/issues/62393).
When a stack-guard interrupt fires inside Sparkplug's
`Builtins_BaselineOutOfLinePrologue` and starts a mark-compact collection, the
conservative root scan walks the half-built baseline `InternalFrame`, and
`ClearStaleLeftTrimmedPointerVisitor` dereferences a junk slot —
`EXC_BAD_ACCESS / KERN_INVALID_ADDRESS at 0xe`, every time, on every machine in
the upstream thread and in this repo's own crash report
(`~/Library/Logs/DiagnosticReports/node-2026-08-20-155211.ips`, pid 77470 —
the exact pid jest reported that afternoon). The trigger population is "lots of
JS compiled through the baseline tier under `vm`" — i.e. jest's module
sandboxing — which is why test runs hit it and the dev server doesn't seem to.

Timing-dependent, so anything that shifts GC pressure shifts the odds: a warm
SWC transform cache makes runs lighter and faster, which is the entire truth
behind "it always works the second time."

## Why it survived — a two-year misattribution

This repo *had* a real native-binding segfault in June 2026: real-SQLCipher
suites running under jsdom, fixed then with `@jest-environment node` docblocks
plus `workerIdleMemoryLimit`. Every SIGSEGV since inherited that diagnosis —
"the known native-SQLCipher worker-teardown flake, run it again." The crash
report that broke the story open showed the dying worker had **no**
`better_sqlite3.node` loaded at all: whatever was crashing, it wasn't the
binding. From there the faulting stack matched nodejs/node#62393
frame-for-frame, down to the `0xe`.

Two lessons worth the ink: a *fixed* bug's ghost can misfile every later bug
that shares its symptom, and macOS keeps the receipts — one `.ips` file in
`DiagnosticReports` ended a months-long guessing game in about a minute.

## How to verify

- Workers carry the flag: while a suite runs,
  `ps -axo command | grep -c 'no-sparkplug.*processChild'` counts the fleet.
- Soak: repeated full `npm run test:unit` runs (alternating `npx jest
  --clearCache` to recreate the heavier cold-cache condition) with
  `~/Library/Logs/DiagnosticReports/node-*.ips` watched for new arrivals.
  Upstream's matrices say the same thing at larger n: 0 crashes in 40, 6, and
  4 flagged runs against 1-in-5-ish unflagged, at no measurable wall-time cost.
- Retiring it someday: the guard should outlive the upstream bug, not the
  repo. When nodejs/node#62393 is actually fixed in the supported Node lines
  (verify against the issue, not the changelog), delete `armSparkplugGuard()`
  and return the scripts to plain `jest`.
- Regression coverage: `__tests__/unit/jest-sparkplug-guard.test.ts` asserts the
  flag is present — exactly once — in the process a suite actually runs in. A
  crash cannot be asserted on directly, so the guard is what is pinned: if the
  flag ever stops arriving, that suite goes red instead of the segfaults
  quietly returning and being re-run away.
