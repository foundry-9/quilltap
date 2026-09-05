# Bug 89 — the PDF rasteriser's native binary is stripped from the tarball and never put back

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-22) |
| **Found** | 2026-08-22 |
| **Fixed** | 2026-08-22 |
| **Severity** | Medium (PDF rendering fails on the `npx quilltap` path; nothing else is affected, and the failure is a module-not-found deep in pdfjs rather than a startup crash) |
| **Who it bites** | anyone running Quilltap through the `quilltap` npm package (`npx quilltap` / `npm i -g quilltap`) who asks anything to render a PDF. Docker is unaffected — it ships the full production `node_modules`. |
| **Provenance** | Found by inspection while reviewing the GitHub Actions pipeline, not from a user report |
| **Fix site** | `packages/quilltap/bin/quilltap.js` (`linkNativeModules` — new `linkScopedPlatformSiblings` helper, and an `@napi-rs/canvas` case) |
| **v5 status** | Not investigated — any v5 launcher that prunes platform binaries from a shared tree owes the same relink step |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-22).** `linkNativeModules` now links `@napi-rs/canvas`
and its `@napi-rs/canvas-*` platform siblings into the standalone tree, exactly
as it already did for `sharp` and `@img/sharp-*`. The per-scope sibling walk is
now one helper used by both, so a third native cannot be half-wired the same
way.

### Symptom

On the `npx quilltap` path, anything that rasterises a PDF fails to resolve
`@napi-rs/canvas`'s native binding. The app starts normally and everything else
works; the failure appears only when `pdfjs-dist` first reaches for the canvas
backend.

### Root cause

Three pieces that were individually correct and collectively wrong.

1. `scripts/build-standalone-tarball.mjs` strips every `@napi-rs/canvas-*`
   platform package from the tarball, keeping only the pure-JS wrapper. This is
   deliberate and correct — a platform binary must not ride along in a
   platform-agnostic tarball.
2. `packages/quilltap/package.json` declares `@napi-rs/canvas` as a runtime
   dependency, so npm installs a correct build on the user's machine. Also
   correct — that is the replacement for the stripped copy.
3. `linkNativeModules` in `packages/quilltap/bin/quilltap.js` links
   `better-sqlite3`, `node-pty`, `sharp` and `@img/sharp-*` into the standalone
   tree — and never mentioned `@napi-rs` at all.

Nothing bridged (1) and (2). The gap is not survivable by module resolution:
the standalone tree is extracted into the download cache
(`~/Library/Caches/Quilltap/standalone` on macOS, `~/.cache/quilltap/standalone`
on Linux, `%LOCALAPPDATA%\Quilltap\standalone` on Windows), nowhere near the
npm package's own `node_modules`, so Node's upward walk from the wrapper can
never reach the copy npm installed. Bridging that gap is the entire reason
`linkNativeModules` exists.

`@napi-rs/canvas` also requires its binary as a **scope sibling**
(`@napi-rs/canvas-darwin-arm64` resolved from inside `@napi-rs/canvas`), so
linking the wrapper alone would not have been enough either — the siblings have
to land in the same `node_modules` the wrapper is resolved from. That is the
same shape as `sharp` → `@img/sharp-*`, which is why the fix is one shared
helper rather than a second bespoke block.

### Why it survived

Both halves landed within two weeks of each other and each looked complete on
its own. `7cba1eb4` (2026-05-05) added the tarball strip; `4367a52f` (2026-05-18)
added the CLI dependency. Neither touched `linkNativeModules`, and the sharp
precedent sitting directly above it made the omission invisible on review — the
file *looks* like it handles this class of module.

Nothing tests it. PDF rendering is not exercised by CI, and the failure is
inert until a PDF is actually rasterised, so a green release proves nothing
here.

### The fix

`linkNativeModules` grows one helper, `linkScopedPlatformSiblings(scope, prefix,
wrapperName, wrapperDir)`, which links every `<scope>/<prefix>*` package sitting
beside a resolved wrapper. It walks back exactly as many path segments as the
wrapper's own name has, so it is correct for an unscoped wrapper (`sharp` → one)
and a scoped one (`@napi-rs/canvas` → two) alike; counting fixed levels would
resolve one directory too high for `sharp` and miss `@img` entirely.

The bespoke `@img` block is replaced by a call to it, and `@napi-rs/canvas` gets
a wrapper link plus the same sibling call.

### How to verify

From a clean cache, on the npx path:

```bash
rm -rf ~/Library/Caches/Quilltap/standalone   # or the platform equivalent
npx quilltap
```

Then, against the extracted tree:

```bash
ls -l ~/Library/Caches/Quilltap/standalone/*/node_modules/@napi-rs/
```

Both `canvas` and a `canvas-<platform>-<abi>` entry must be present as symlinks.
Before the fix, `canvas` was a real directory and no `canvas-*` sibling existed.
Then render a PDF in the app and confirm no module-resolution error appears.
