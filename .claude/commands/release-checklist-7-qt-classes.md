# Release Checklist 7 — `qt-*` Theme Utility Classes

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 7 of 13):** New UI components must use `qt-*` theme utility classes rather than raw Tailwind, so themes can restyle them. Where you'd reach for a new Tailwind class, add a `qt-*` utility and apply that instead.

## Scope

```bash
LAST_TAG=$(git describe --tags --abbrev=0 --match '[0-9]*.[0-9]*.[0-9]*' 2>/dev/null)
git diff --name-only "${LAST_TAG}"..HEAD -- 'app/**/*.tsx' 'components/**/*.tsx' '*.tsx' | grep -vE '__tests__|\.test\.|\.stories\.' | sort -u
```

## Steps

1. In each new/changed component, look at `className` values for hard-coded Tailwind that should be a semantic `qt-*` class — especially colors, backgrounds, borders, surfaces, and typography that themes need to control:
   ```bash
   git diff "${LAST_TAG}"..HEAD -- '*.tsx' | grep -nE '^\+.*className=' | grep -vE 'qt-'
   ```
2. For each, either apply an existing `qt-*` utility or, if none fits, add a new `qt-*` utility and use it.
3. **Propagate significant `qt-*` changes** (per CLAUDE.md): the stylebook, [theme-storybook](../../packages/theme-storybook), possibly [create-quilltap-theme](../../packages/create-quilltap-theme), and the bundled themes in `themes/bundled/`.
4. Remember the deliberate exception: don't swap `<img>` for Next.js `<Image>` — that's intentional where sources come from APIs Next can't pre-resolve.
5. Verify: `npx tsc` and a quick visual check via the dev server preview if layout/theming changed.

## Report

List components reviewed and any Tailwind→`qt-*` conversions (`file:line`). Note new `qt-*` utilities added and where they were propagated. Do not commit.
