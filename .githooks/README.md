# Git Hooks

This directory contains git hooks for the Quilltap project.

## Hooks

### pre-commit
Automatically bumps the patch version in `package.json` and `package-lock.json` before each commit.

**Behavior:**
- Extracts the current semver version from package.json
- Increments the patch version (e.g., 0.1.0 → 0.1.1)
- Updates both package.json and package-lock.json
- Stages the updated files so they're included in the commit

**Example:**
```
$ git commit -m "Add feature X"
# pre-commit hook runs and bumps version to 0.1.1
# Stages the updated package files
# Commit is created with both your changes and the version bump
```

## Configuration

The git hooks path is configured in `.git/config` via:
```bash
git config core.hooksPath .githooks
```

This setting is local to the repository and will be respected by all developers who clone the repository (Git 2.9+).

## Development

To modify or add hooks:
1. Edit the script file in `.githooks/`
2. Ensure the script is executable: `chmod +x .githooks/hook-name`
3. Test your changes before committing

## Disabling Hooks

If you need to skip the pre-commit hook for a specific commit, use:
```bash
git commit --no-verify -m "Your message"
```
