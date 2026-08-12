# Tag for Production Release

This command builds the release commit with a tree-copy strategy (immune to stale merge bases) and then merges the tagged release back into main so history stays connected. After a release is tagged, `git log <tag>..main` reflects everything done on main since that release.

**Important:** Do not use sed commands with regexp group backreferences (like `\1`) in Bash tool calls — they get mangled. Instead, use the Edit tool to modify `package.json`, `README.md`, and other files directly. The instructions below describe *what* to change in each file, with examples.

## Release notes

Every tagged release **must** have a release notes file at `docs/releases/<version>.md`.

### Bugfix releases (patch version bump from `bugfix` branch)

Write release notes yourself in the standard Quilltap prose style ("steampunk + roaring 20s + Great Gatsby + Wodehouse + Lemony Snicket"). Bugfix release notes should be brief — a paragraph or two describing what was fixed and why. Use this frontmatter format:

```markdown
---
title: "Version X.Y.Z released"
version: "X.Y.Z"
pubDate: YYYY-MM-DD
description: "Brief one-line description of the fix"
draft: false
---

# Quilltap X.Y.Z Release Notes

[Prose description of the fix in the standard Quilltap style]
```

Then include the standard installation section (copy from the most recent release notes file).

### Major or minor releases (from `main` branch)

Ask the developer: "Would you like to write the release notes yourself, or shall I draft them in the Quilltap style?" If they want you to write them, review all commits since the last release (`git log <last-tag>..HEAD`) and write substantial release notes in the standard prose style, following the pattern in `docs/releases/4.0.0.md`. Include the standard installation section.

## If current branch is `main`

This is how we tag a commit in main for release.

### Step 1: Set up the release branch

```bash
git checkout release
# Tree-copy: make release's working tree identical to main's
git rm -rf .
git checkout main -- .
git add -A
```

Now determine the release version. The version in `package.json` will look like `X.Y.0-dev.N`. The release version is `X.Y.0` (strip the `-dev.N` suffix).

**Edit `package.json`:** Change `"version": "X.Y.0-dev.N"` to `"version": "X.Y.0"`

**Example:** `"version": "4.1.0-dev.3"` becomes `"version": "4.1.0"`

```bash
npm install
```

Note the release version (e.g., `4.1.0`) — you'll need it for all remaining steps. Call it NEWRELEASE.

**Edit `README.md`:** Change the "This Version" badge to show the release version in green.

**Example:** `badge/version-4.1.0--dev.3-yellow.svg` becomes `badge/version-4.1.0-green.svg`

### Step 2: Fix changelog for release branch

The changelog should list changes under the release version heading. If there's an `x.y-dev` heading, rename it to `x.y.0`. Ensure the format matches:

```markdown
### 4.1.0

- feat: Description of feature
- fix: Description of fix

### 4.0.0

- (previous release entries)
```

### Step 3: Write release notes

Create `docs/releases/NEWRELEASE.md` following the release notes instructions above. This file must be committed as part of the release commit.

### Step 4: Commit and tag the release

```bash
git add package.json package-lock.json README.md docs/releases/NEWRELEASE.md
git commit --no-verify -m "release: NEWRELEASE"
git tag -s -m "NEWRELEASE" NEWRELEASE
```

(Replace NEWRELEASE with the actual version string, e.g., `4.1.0`)

### Step 5: Merge the release back into main

```bash
git checkout main
git merge --no-ff release -m "merge: NEWRELEASE back into main"
git tag "rel/NEWRELEASE"
```

(Replace NEWRELEASE with the actual version, e.g., `4.1.0`.)

This brings the release commit and tag into main's history so `git log NEWRELEASE..main` reflects everything done on main since the release. Conflicts are rare in this direction — release was tree-copied from main — but if any appear, take release's version. The next step bumps version files anyway, so the merge's version-file state on main is transient.

**The `rel/NEWRELEASE` anchor tag** is a lightweight tag placed on the merge-back commit, which lives on main's first-parent line. The official `NEWRELEASE` version tag lives on the squashed release branch, so `git describe` can't measure a meaningful distance against it (the squash severs ancestry, putting every release tag on a merge's *second* parent). The `rel/*` anchor fixes this: `git describe --tags --first-parent --match 'rel/*'` yields a real "commits on main since the release" distance, which the shell prompt uses. Keep the `rel/` prefix and namespace exactly — the prompt strips it for display and filters on it.

### Step 6: Start the new dev branch on main

Calculate the next minor version: increment the middle number and reset patch to 0. For example, `4.1.0` becomes `4.2.0`.

```bash
git checkout main
```

**Edit `package.json`:** Set the version to the new dev version.

**Example:** `"version": "4.1.0"` (or whatever it was) becomes `"version": "4.2.0-dev.0"`

```bash
npm install
```

**Edit `README.md`:** Update the badge to show the new dev version in yellow.

**Example:** `badge/version-4.1.0-green.svg` becomes `badge/version-4.2.0--dev.0-yellow.svg`

(Note: the `--` in the badge URL is how shields.io escapes a literal hyphen.)

### Step 7: Fix changelog for main branch

Add a new dev heading above the release heading:

```markdown
### 4.2-dev

(empty — new development starts here)

### 4.1.0

- (entries from the release)
```

### Step 8: Commit and tag main

```bash
git add package.json package-lock.json README.md
git commit --no-verify -m "dev: started NEWDEVVERSION development"
git tag -s -m "NEWDEVVERSION-dev" NEWDEVVERSION-dev
```

(Replace NEWDEVVERSION with the actual version, e.g., `4.2.0`)

### Step 9: Set up the new bugfix branch

The bugfix branch version should be one patch ahead of the release. For example, if the release was `4.1.0`, the bugfix branch starts at `4.1.1-bugfix.0`.

```bash
git checkout bugfix
# Tree-copy: make bugfix's working tree identical to release's
git rm -rf .
git checkout release -- .
git add -A
```

**Edit `package.json`:** Set the version to the next patch with bugfix suffix.

**Example:** `"version": "4.1.0"` becomes `"version": "4.1.1-bugfix.0"`

```bash
npm install
```

**Edit `README.md`:** Update the badge to show the bugfix version in yellow.

**Example:** `badge/version-4.1.0-green.svg` becomes `badge/version-4.1.1--bugfix.0-yellow.svg`

```bash
git add package.json package-lock.json README.md
git commit --no-verify -m "bugfix: started NEWRELEASE bug branch"
```

(Where the commit message uses the *release* version, e.g., "bugfix: started 4.1.0 bug branch")

### Step 10: Push everything

```bash
git push
git checkout main
git push
git checkout release
git push
git push --tags
```

---

## If current branch is `bugfix`

### Step 1: Merge bugfix changes into release

```bash
git checkout release
# Tree-copy: make release's working tree identical to bugfix's
git rm -rf .
git checkout bugfix -- .
git add -A
```

Now determine the release version. The version in `package.json` will look like `X.Y.Z-bugfix.N`. The release version is `X.Y.Z` (strip the `-bugfix.N` suffix).

**Edit `package.json`:** Remove the `-bugfix.N` suffix from the version.

**Example:** `"version": "4.0.2-bugfix.0"` becomes `"version": "4.0.2"`

```bash
npm install
```

Note the release version (e.g., `4.0.2`) — you'll need it for all remaining steps. Call it NEWRELEASE.

**Edit `README.md`:** Change the badge to show the release version in green.

**Example:** `badge/version-4.0.2--bugfix.0-yellow.svg` becomes `badge/version-4.0.2-green.svg`

### Step 2: Fix changelog for release branch

Ensure the changelog has changes listed under the release version heading (e.g., `### 4.0.2`). This should already be correct from the bugfix branch.

### Step 3: Write release notes

Create `docs/releases/NEWRELEASE.md` following the release notes instructions above (bugfix style — brief prose about what was fixed). This file must be committed as part of the release commit.

### Step 4: Commit and tag the release

```bash
git add package.json package-lock.json README.md docs/releases/NEWRELEASE.md
git commit --no-verify -m "release: NEWRELEASE"
git tag -s -m "NEWRELEASE" NEWRELEASE
```

(Replace NEWRELEASE with the actual version, e.g., `4.0.2`)

If `git tag -s` fails due to signing issues, fall back to `git tag -a -m "NEWRELEASE" NEWRELEASE`.

### Step 5: Merge the release back into main

```bash
git checkout main
git merge --no-ff release -m "merge: NEWRELEASE back into main"
```

(Replace NEWRELEASE with the actual version, e.g., `4.0.2`.)

This brings the release commit and tag into main's history so `git log NEWRELEASE..main` works. Expect conflicts here — main has been moving forward on its dev branch while the bugfix was prepared. Resolve them as follows:

- **package.json, package-lock.json, README.md**: keep main's version (the in-progress dev version, e.g. `4.1.0-dev.N`). Do not downgrade main to the bugfix release version.
- **docs/CHANGELOG.md**: keep both sets of entries — main's new dev-cycle entries above the bugfix entries.
- **Code conflicts**: resolve case-by-case. The bugfix change is usually the intended fix; if the dev branch already supersedes it, prefer the dev version.

Commit the merge resolution before moving on. Then place the anchor tag on the merge-back commit (now at `main`'s HEAD):

```bash
git tag "rel/NEWRELEASE"
```

(Replace NEWRELEASE with the actual version, e.g., `4.0.2`.) See the explanation of the `rel/*` anchor tag in the `main`-branch flow's Step 5 — it gives the shell prompt a meaningful "commits since release" distance that the official version tag (on the squashed release branch) cannot.

### Step 6: Restart bugfix from the new release

The bugfix branch version should be one patch ahead of the release. For example, if the release was `4.0.2`, the bugfix branch starts at `4.0.3-bugfix.0`.

```bash
git checkout bugfix
# Tree-copy: make bugfix's working tree identical to release's
git rm -rf .
git checkout release -- .
git add -A
```

**Edit `package.json`:** Set the version to the next patch with bugfix suffix.

**Example:** `"version": "4.0.2"` becomes `"version": "4.0.3-bugfix.0"`

```bash
npm install
```

**Edit `README.md`:** Update the badge to show the new bugfix version in yellow.

**Example:** `badge/version-4.0.2-green.svg` becomes `badge/version-4.0.3--bugfix.0-yellow.svg`

```bash
git add package.json package-lock.json README.md
git commit --no-verify -m "bugfix: started NEWRELEASE bug branch"
```

(Where the commit message uses the *release* version, not the bugfix version — e.g., "bugfix: started 4.0.2 bug branch")

### Step 7: Push everything

```bash
git push
git checkout main
git push
git checkout release
git push
git push --tags
```
