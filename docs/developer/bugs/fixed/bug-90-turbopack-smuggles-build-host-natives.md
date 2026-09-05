# Bug 90 — a Turbopack-built tarball smuggles the build host's native binaries to every target host

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-23) |
| **Found** | 2026-08-23 |
| **Fixed** | 2026-08-23 |
| **Severity** | **Critical** (the app cannot start at all — the database is unreachable, so migrations fail and the server exits) |
| **Who it bites** | **every consumer of 4.9.0-dev.52, on every platform.** The macOS/Windows tarball and Electron shell, the `npx quilltap` path, AND both Docker images — `Dockerfile.ci` copies the single x86-64-built artifact into the arm64 image too. |
| **Provenance** | Live (Friday, 2026-08-23 03:46 UTC, `logs/startup.log`) — first launch after tagging 4.9.0-dev.52 |
| **Fix site** | `.github/workflows/release.yml` (`build-app`), mirrored in `.github/workflows/ci.yml` (`build`) and `scripts/build-standalone-tarball.mjs` (step 3) — all three pinned to `--webpack`; plus a new `scripts/assert-standalone-portable.mjs` gate |
| **v5 status** | Not applicable to a port of app logic; applies to any v5 packaging step that prunes natives by path out of a bundler's standalone output |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-23).** All three `next build` call sites that can feed
the standalone tarball are pinned to `--webpack`. This is a **self-inflicted
regression**: the immediately preceding commit (`65f3476e`) switched
`release.yml` to Turbopack to converge it with the other two call sites, on the
belief that the only difference was which modules got traced. It is not.

### Symptom

`4.9.0-dev.52` starts, binds port 5050, then fails every SQLite connection
attempt and exits:

```
sqlite connection attempt 1/10 failed …
dlopen(…/Caches/Quilltap/standalone/.next/node_modules/better-sqlite3-90e2652d1716b047/build/Release/better_sqlite3.node, 0x0001):
  tried: '…/better_sqlite3.node' (slice is not valid mach-o file)
…
Migrations failed - cannot start server: sqlite not accessible
```

Note the path: `.next/node_modules/better-sqlite3-90e2652d1716b047/`, not
`node_modules/better-sqlite3/`.

### Both failure modes

The same smuggled file produces two different-looking errors, which is why it
read at first as two bugs:

| target | error | why |
|---|---|---|
| macOS arm64 (tarball / Electron) | `slice is not valid mach-o file` | an ELF where a Mach-O is required |
| **Docker arm64** | `cannot open shared object file: No such file or directory` | dlopen's famously misleading message — the `.node` is present (2,685,264 bytes) but is x86-64 on an aarch64 host |

Verified in the published image. `e_machine` at ELF offset `0x12`:

```
container arch                          : aarch64
/app/.next/node_modules/better-sqlite3-…  : 3e 00  → EM_X86_64  (smuggled)
/app/node_modules/better-sqlite3/…        : b7 00  → EM_AARCH64 (correct, unused)
```

Docker is hit for a reason worth stating on its own: `build-app` runs **once**,
on `ubuntu-latest` (x86-64), and `Dockerfile.ci` copies that one artifact into
**both** the amd64 and the arm64 image. The design is sound — the artifact is
supposed to be pure JS, and each image rebuilds its own natives in `deps-prod`.
Turbopack broke the premise, and the arm64 image ended up carrying an x86-64
binary that shadows the aarch64 one `deps-prod` built correctly.

### Root cause

Turbopack and webpack produce **structurally different** standalone trees, and
the tarball's native-stripping only understands webpack's.

Turbopack copies each externalized package into
`.next/node_modules/<pkg>-<contenthash>/` and rewrites requires to point at
that copy. webpack's NFT output places them at `node_modules/<pkg>`.

`scripts/build-standalone-tarball.mjs` strips platform binaries **by name**
against `<staging>/node_modules/<pkg>` — `better-sqlite3`, `@img/sharp-*`,
`@napi-rs/canvas-*`. It has no knowledge of the hashed copies, so under
Turbopack they are never stripped and the tarball is no longer
platform-agnostic. It carries whatever the **build host** compiled, and CI
builds on `ubuntu-latest`.

Both copies then exist in the extracted tree, and the wrong one wins:

| path | arch | how it got there |
|---|---|---|
| `node_modules/better-sqlite3/build/Release/better_sqlite3.node` | Mach-O arm64 | correct — symlinked by the launcher |
| `.next/node_modules/better-sqlite3-90e2652d1716b047/build/Release/better_sqlite3.node` | **ELF x86-64** | smuggled — and it is the path the bundle requires |

`node-pty` is affected identically (`.next/node_modules/node-pty-592e8dc…/build/Release/pty.node`
is also a Linux ELF); `sharp` has a hashed copy too.

### Why only SQLite actually died

`node-pty` was smuggled identically — `.next/node_modules/node-pty-592e8dc…/build/Release/pty.node`
is the same Linux ELF — yet terminals kept working (confirmed on dev.50 under
the Electron shell). The difference is the loader, not the packaging.

`node-pty`'s `loadNativeModule` (`lib/utils.js`) walks
`['build/Release', 'build/Debug', 'prebuilds/<platform>-<arch>']` with **every
candidate wrapped in try/catch**, so the wrong-arch binary throws, is swallowed,
and the loop falls through to the correct `prebuilds/darwin-arm64` copy.
`better-sqlite3` resolves through a single hard-coded path with no fallback, so
a bad binary there is fatal.

The lesson for the guard: a smuggled native is a defect whether or not the
consuming loader happens to survive it. `assert-standalone-portable.mjs`
therefore rejects **all** natives under `.next/`, not merely the ones observed
to break something.

(Note this does not contradict `standalone-server-bootstrap.js`'s comment that
node-pty "PREFERS build/Release over prebuilds" — that is true of the *order*,
and it is exactly what bites in the case that shim handles: an ABI rebuild
leaves a `build/Release/pty.node` that loads **successfully**, wins the walk,
and then has no `spawn-helper` sibling.)

### Why it survived

Three independent reasons, which is why it took a switch on the *release* path
to expose it:

1. **The strip never covered the Turbopack layout, going back to 7cba1eb4
   (2026-05-05)** — the commit that moved the local tarball build to Turbopack.
   Nobody noticed, because a local build runs on macOS and *for* macOS: the
   smuggled binary was coincidentally the right platform.
2. **CI cannot catch it.** The release workflow builds the tarball on Linux and
   never executes it on a non-Linux host. Run 32614939380 went green in 11m45s
   and produced a tarball that cannot start on any Mac.
3. **The reasoning that motivated the change was sound but incomplete.** The
   `--webpack` flag genuinely *was* stale relative to
   `build-standalone-tarball.mjs`, and converging them was the right instinct.
   The error was converging in the wrong direction without testing the artifact
   on a target platform.

### The fix

`--webpack` at all three call sites, each carrying a comment saying it is
load-bearing and pointing here, because "this flag looks stale" is exactly the
observation that caused the regression.

The original reason for reaching for Turbopack — `loadWebpackHook` failing on
`next/dist/compiled/webpack/webpack-lib`, which webpack's tracer does not
follow — is already handled by `scripts/standalone-server-bootstrap.js`
(`8183d6ec`, four days after `7cba1eb4`). It sets
`__NEXT_PRIVATE_STANDALONE_CONFIG` from `.next/required-server-files.json` so
the hook is never reached. That shim is why every webpack-built release from
4.5 through 4.9.0-dev.51 shipped and ran correctly.

### The guard

`--webpack` is a *convention*, and this bug is proof that conventions do not
survive a plausible-looking cleanup. `scripts/assert-standalone-portable.mjs`
enforces the actual invariant instead: **no native binary may live anywhere
under `<standalone>/.next/`.** That subtree is bundler-internal and no consumer
strips or replaces it, so anything native in there is by definition smuggled.
`<standalone>/node_modules/` is exempt — Docker replaces it wholesale and the
tarball strips it by name.

It runs in `build-app` before the artifact is uploaded (so it protects Docker
and the tarball equally) and again in `build-standalone-tarball.mjs` before the
tarball is written. It was verified against the real broken dev.52 artifact
extracted from `foundry9/quilltap:dev`, which it rejects, and against a tree
whose natives sit only in `node_modules/`, which it accepts.

Note what this replaces: **CI had no way to catch this.** Run 32614939380 went
green in 11m45s and published a tarball and two images that could not start.
The pipeline builds on Linux and never executes the artifact on any other
platform, so nothing downstream of the build was ever going to notice.

### If Turbopack is ever wanted here

It is not enough to flip the flag. The strip in step 7 must also walk
`<staging>/.next/node_modules/` and handle `<pkg>-<contenthash>` directories,
**and** the result has to be verified to fall through to the launcher-symlinked
copy at `<standalone>/node_modules/<pkg>` rather than failing with
MODULE_NOT_FOUND. That needs a real cross-platform test — build on Linux, run
on macOS — which no automated check currently performs.

### How to verify

After a release, on a Mac, from a cold cache:

```bash
rm -rf ~/Library/Caches/Quilltap/standalone
npx quilltap --instance V4test
```

It must reach "Quilltap server listening" and run migrations. Then assert the
tarball smuggled nothing:

```bash
find ~/Library/Caches/Quilltap/standalone/.next -name '*.node'
```

That must return **nothing**. Then the arm64 image:

```bash
docker run --rm --entrypoint sh foundry9/quilltap:<tag> -c 'find /app/.next -name "*.node"'
```

Also nothing. Both are what `scripts/assert-standalone-portable.mjs` now checks
at build time, so a green release should make these formalities.
