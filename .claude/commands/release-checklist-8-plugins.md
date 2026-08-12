# Release Checklist 8 — Plugin Self-Containment

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 8 of 13):** Plugins should be self-contained or reach Quilltap internals only through `plugin-types` and `plugin-utils`. Even the distributed plugins in `plugins/dist/` must follow this — they're the reference examples independent plugin developers copy.

## Steps

1. Enumerate the distributed plugins:
   ```bash
   ls -d plugins/dist/*/
   ```
2. For each plugin (focus on ones changed since the last release), check for reach-ins to app internals instead of the sanctioned packages:
   ```bash
   LAST_TAG=$(git describe --tags --abbrev=0 --match '[0-9]*.[0-9]*.[0-9]*' 2>/dev/null)
   git diff --name-only "${LAST_TAG}"..HEAD -- 'plugins/**' | sort -u
   # Suspicious imports: deep relative paths escaping the plugin, or @/lib app internals
   grep -rnE "from '(\.\./){2,}|from '@/lib|require\('(\.\./){2,}" plugins/dist --include='*.ts' --include='*.js'
   ```
3. Confirm each plugin imports Quilltap surfaces via `@quilltap/plugin-types` and `@quilltap/plugin-utils` (or is fully self-contained). Refactor any violation.
4. Watch the known pitfalls from project memory:
   - Provider plugins must **normalize usage to exclude prompt-cache hits** (see the cache-excluded-tokens convention).
   - Plugins that depend on `@quilltap/plugin-utils` must **bundle** it (the Mistral plugin shipped unbundled and broke installs).
   - New-generation Anthropic model params branch by model-ID prefix — don't regress that.
5. **If you changed any plugin:** bump the patch version in its `package.json` (and `manifest.json` if needed), then rebuild:
   ```bash
   npm run build:plugins
   ```
   Stage the rebuilt `plugins/dist/` artifacts.

## Report

Per plugin: **SELF-CONTAINED / USES PLUGIN-UTILS** or **FIXED** (with the reach-in removed). If any plugin changed, confirm the version bump and that `npm run build:plugins` ran clean. Do not commit.
