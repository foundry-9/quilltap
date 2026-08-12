# Release Checklist 13 — Documentation Freshness

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 13 of 13):** Verify these Markdown/doc files are up to date for the release:

- [README](../../README.md)
- [Changelog](../../docs/CHANGELOG.md)
- [API Documentation](../../docs/developer/API.md)
- [Developer Documentation](../../docs/developer/DEVELOPMENT.md)
- [Claude instructions](../../CLAUDE.md)
- [About Page](../../app/about/page.tsx)
- [Release notes for this release](../../docs/releases/) — **MUST EXIST for a production release** and must match the `version` in `package.json` exactly (or the version being released).

## Steps

1. Get the release version and the change surface:
   ```bash
   node -e "console.log(require('./package.json').version)"
   LAST_TAG=$(git describe --tags --abbrev=0 --match '[0-9]*.[0-9]*.[0-9]*' 2>/dev/null)
   git log --oneline "${LAST_TAG}"..HEAD
   ```
2. Walk each file:
   - **README** — features list, version badge, anything user-facing that changed.
   - **CHANGELOG** — every notable change recorded. **Plain American English, no steampunk voice** (CLAUDE.md override). Don't duplicate section headers — append under the existing one.
   - **API.md** — matches the actual `/api/v1/` routes (ties to checklist item 4).
   - **DEVELOPMENT.md** — dev workflow still accurate.
   - **CLAUDE.md** — any new conventions/chokepoints/glossary entries introduced this cycle.
   - **about/page.tsx** — version, credits, feature blurbs.
   - **docs/releases/{version}.md** — exists and matches `package.json` version exactly. If missing for a production release, follow the release-notes format in [tag-for-release](tag-for-release.md) / the pattern in `docs/releases/`.
3. Also confirm the broader doc set from [update-documentation](update-documentation.md) is current — user-visible changes need `help/*.md` updates (with `url` frontmatter + matching `help_navigate(...)`), and the docs listed there stay in sync. Consider running `/update-documentation` if a lot changed.
4. Fix anything stale.

## Report

Per file: **CURRENT** or **UPDATED** (with a one-line note). Explicitly confirm the `docs/releases/{version}.md` file exists and matches `package.json`, or flag that it's missing. Do not commit.
