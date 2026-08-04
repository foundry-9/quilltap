#!/bin/bash

set -euo pipefail

if [[ "$OSTYPE" == "darwin"* ]]; then
  SED_INPLACE=(-i '')
else
  SED_INPLACE=(-i)
fi

CURRENT_VERSION=$(grep -m1 '"version"' package.json | sed 's/.*"\([^"]*\)".*/\1/')
BASE_VERSION=$(echo "$CURRENT_VERSION" | sed -E 's/^([0-9]+\.[0-9]+\.[0-9]+).*/\1/')
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
BASE_VERSION_FIRST_COMMIT=""

while IFS= read -r commit_hash; do
  VERSION_AT_COMMIT=$(git show "$commit_hash:package.json" 2>/dev/null | grep -m1 '"version"' | sed 's/.*"\([^"]*\)".*/\1/' || echo "")
  COMMIT_BASE=$(echo "$VERSION_AT_COMMIT" | sed -E 's/^([0-9]+\.[0-9]+\.[0-9]+).*/\1/')

  if [ "$COMMIT_BASE" = "$BASE_VERSION" ]; then
    PARENT_COMMIT="${commit_hash}^"
    PARENT_VERSION=$(git show "$PARENT_COMMIT:package.json" 2>/dev/null | grep -m1 '"version"' | sed 's/.*"\([^"]*\)".*/\1/' || echo "")
    PARENT_BASE=$(echo "$PARENT_VERSION" | sed -E 's/^([0-9]+\.[0-9]+\.[0-9]+).*/\1/')

    if [ "$PARENT_BASE" != "$BASE_VERSION" ]; then
      BASE_VERSION_FIRST_COMMIT="$commit_hash"
      break
    fi
  fi
done < <(git log --format="%h" -- package.json 2>/dev/null)

if [ -n "$BASE_VERSION_FIRST_COMMIT" ]; then
  COMMIT_COUNT=$(git rev-list --count "$BASE_VERSION_FIRST_COMMIT"..HEAD 2>/dev/null || echo "0")
else
  COMMIT_COUNT=0
fi

if [[ "$CURRENT_BRANCH" == "release" || "$CURRENT_BRANCH" == release/* ]]; then
  CHANNEL=""
  BADGE_COLOR="green"
elif [[ "$CURRENT_BRANCH" == "main" ]]; then
  CHANNEL="dev"
  BADGE_COLOR="yellow"
else
  CHANNEL=$(echo "$CURRENT_BRANCH" | sed 's/\//-/g')
  BADGE_COLOR="yellow"
fi

if [ -z "$CHANNEL" ]; then
  NEW_VERSION="$BASE_VERSION"
else
  # The commit count is a function of HEAD, so it cannot advance when HEAD does
  # not: re-running the script, amending, or amending in a fast-forwarded branch
  # commit all recompute the same number. Worse, amending stamps HEAD's own
  # distance into the commit at that distance, which leaves every later
  # pre-commit run reproducing the stored number for good. Treat the count as a
  # floor and force a strict increase over whatever is already recorded for this
  # same base and channel, so running the script always bumps.
  PREFIX="$BASE_VERSION-$CHANNEL."
  GUARDED_FROM=""

  if [[ "$CURRENT_VERSION" == "$PREFIX"* ]]; then
    CURRENT_SUFFIX="${CURRENT_VERSION#"$PREFIX"}"

    if [[ "$CURRENT_SUFFIX" =~ ^[0-9]+$ ]] && [ "$COMMIT_COUNT" -le "$CURRENT_SUFFIX" ]; then
      GUARDED_FROM="$COMMIT_COUNT"
      COMMIT_COUNT=$((CURRENT_SUFFIX + 1))
    fi
  fi

  NEW_VERSION="$PREFIX$COMMIT_COUNT"
fi

sed "${SED_INPLACE[@]}" -E "s/\"version\": \"[^\"]+\"/\"version\": \"$NEW_VERSION\"/" package.json

# Sync version to the quilltap npm package (thin CLI launcher)
if [ -f packages/quilltap/package.json ]; then
  sed "${SED_INPLACE[@]}" -E "s/\"version\": \"[^\"]+\"/\"version\": \"$NEW_VERSION\"/" packages/quilltap/package.json
fi

if [ -f README.md ]; then
  BADGE_VERSION=$(echo "$NEW_VERSION" | sed 's/-/--/g')
  sed "${SED_INPLACE[@]}" -E "s|badge/version-[^]]+\.svg|badge/version-$BADGE_VERSION-$BADGE_COLOR.svg|" README.md
fi

echo "✅ Version set: $NEW_VERSION (base: $BASE_VERSION, branch: $CURRENT_BRANCH)"

if [ -n "${GUARDED_FROM:-}" ]; then
  echo "   ↑ commit count was $GUARDED_FROM, not ahead of the recorded $CURRENT_VERSION — stepped past it instead."
fi
