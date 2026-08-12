#!/usr/bin/env bash
set -euo pipefail

# Quilltap Docker startup script
# Detects platform, sets sensible defaults, and starts the container.
#
# Usage:
#   ./scripts/start-quilltap.sh [options]
#
# Options:
#   -d, --data-dir DIR          Data directory on host (default: platform-specific)
#   -p, --port PORT             Host port (default: 3000)
#   -n, --name NAME             Container name (default: quilltap)
#   -t, --tag TAG               Image tag (default: latest)
#   -e, --env KEY=VALUE         Extra environment variable (repeatable)
#   --restart POLICY            Restart policy (default: unless-stopped)
#   --dry-run                   Print the docker command without running it
#   -h, --help                  Show this help message
#
# Environment variables (override defaults):
#   QUILLTAP_DATA_DIR           Data directory
#   QUILLTAP_PORT               Host port
#   QUILLTAP_CONTAINER_NAME     Container name
#   QUILLTAP_IMAGE_TAG          Image tag
#   QUILLTAP_TIMEZONE           IANA timezone (default: detected from this host)
#   TZ                          Same; QUILLTAP_TIMEZONE wins if both are set
#
# The host's timezone is detected and passed to the container automatically, so
# scheduled rooms, daily budget rollover, and "today"/"yesterday" recall follow
# your clock rather than UTC. Override with `-e QUILLTAP_TIMEZONE=Europe/Paris`,
# or pin the container to UTC with `-e QUILLTAP_TIMEZONE=UTC`.

IMAGE="foundry9/quilltap"

# Resolve this host's IANA timezone name (e.g. "America/Chicago"), or print
# nothing if it can't be determined confidently.
#
# Deliberately never uses `date +%Z`: that yields an abbreviation such as "CDT",
# which Node's ICU cannot resolve back to a zone — it would silently fall back
# to UTC, which is the exact bug this is meant to avoid.
detect_timezone() {
  _tz=""

  if [ -n "${QUILLTAP_TIMEZONE:-}" ]; then
    _tz="$QUILLTAP_TIMEZONE"
  elif [ -n "${TZ:-}" ]; then
    _tz="$TZ"

  # Node's own ICU lookup — authoritative here, because it returns exactly the
  # name the container will resolve later. Tolerate node not being on PATH.
  elif command -v node >/dev/null 2>&1 &&
       _tz=$(node -p 'Intl.DateTimeFormat().resolvedOptions().timeZone' 2>/dev/null) &&
       [ -n "$_tz" ]; then
    :

  elif [ -r /etc/timezone ]; then                       # Debian/Ubuntu
    _tz=$(head -n1 /etc/timezone 2>/dev/null)
  elif command -v timedatectl >/dev/null 2>&1; then     # systemd
    _tz=$(timedatectl show --property=Timezone --value 2>/dev/null)

  # Strip through "zoneinfo/" so this covers Linux (/usr/share/zoneinfo/...)
  # and macOS (/var/db/timezone/zoneinfo/...) alike.
  elif [ -L /etc/localtime ]; then
    _tz=$(readlink /etc/localtime 2>/dev/null | sed -e 's|.*/zoneinfo/||')
  fi

  # Only emit something that looks like an IANA name. Filters out abbreviations
  # ("CDT") and stray values ("localtime", "posixrules") from odd symlinks.
  case "$_tz" in
    UTC|Etc/*|*/*) printf '%s\n' "$_tz" ;;
    *) ;;
  esac
}

# Detect platform and set default data directory
detect_defaults() {
  case "$(uname -s)" in
    Darwin)
      PLATFORM="macos"
      DEFAULT_DATA_DIR="$HOME/Library/Application Support/Quilltap"
      ;;
    Linux)
      PLATFORM="linux"
      DEFAULT_DATA_DIR="$HOME/.quilltap"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      PLATFORM="windows"
      DEFAULT_DATA_DIR="${APPDATA:-$HOME/AppData/Roaming}/Quilltap"
      ;;
    *)
      PLATFORM="linux"
      DEFAULT_DATA_DIR="$HOME/.quilltap"
      ;;
  esac
}

detect_defaults

# Defaults (env vars override platform defaults)
DATA_DIR="${QUILLTAP_DATA_DIR:-$DEFAULT_DATA_DIR}"
PORT="${QUILLTAP_PORT:-3000}"
CONTAINER_NAME="${QUILLTAP_CONTAINER_NAME:-quilltap}"
IMAGE_TAG="${QUILLTAP_IMAGE_TAG:-latest}"
RESTART_POLICY="unless-stopped"
DRY_RUN=false
EXTRA_ENVS=()

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--data-dir)
      DATA_DIR="$2"; shift 2 ;;
    -p|--port)
      PORT="$2"; shift 2 ;;
    -n|--name)
      CONTAINER_NAME="$2"; shift 2 ;;
    -t|--tag)
      IMAGE_TAG="$2"; shift 2 ;;
    -e|--env)
      EXTRA_ENVS+=("$2"); shift 2 ;;
    --restart)
      RESTART_POLICY="$2"; shift 2 ;;
    --dry-run)
      DRY_RUN=true; shift ;;
    -h|--help)
      # Print the usage block above: comment lines from line 4 until the first
      # non-comment line. awk rather than sed — BSD sed rejects `p }` without a
      # separator, so the old one-liner errored out on macOS instead of helping.
      awk 'NR<4 {next} /^#/ {sub(/^# ?/,""); print; next} {exit}' "$0"
      exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1 ;;
  esac
done

# Create data directory if it doesn't exist
if [ "$DRY_RUN" = false ]; then
  mkdir -p "$DATA_DIR"
fi

# Build docker run command
CMD=(docker run -d
  --name "$CONTAINER_NAME"
  --restart "$RESTART_POLICY"
  -p "${PORT}:3000"
  -v "$DATA_DIR:/app/quilltap"
)

# Pass the host-side data directory so the app can display it in the UI
CMD+=(-e "QUILLTAP_HOST_DATA_DIR=$DATA_DIR")

# Linux needs explicit host.docker.internal mapping for localhost URL rewriting
if [ "$PLATFORM" = "linux" ]; then
  CMD+=(--add-host=host.docker.internal:host-gateway)
fi

# Pass the host timezone through, unless the caller already supplied one via
# -e. An explicit --env always wins; detection only fills the gap.
TIMEZONE=""
TZ_EXPLICIT=false
if [ ${#EXTRA_ENVS[@]} -gt 0 ]; then
  for env in "${EXTRA_ENVS[@]}"; do
    case "$env" in
      QUILLTAP_TIMEZONE=*|TZ=*) TZ_EXPLICIT=true ;;
    esac
  done
fi

if [ "$TZ_EXPLICIT" = false ]; then
  TIMEZONE="$(detect_timezone)"
  if [ -n "$TIMEZONE" ]; then
    CMD+=(-e "QUILLTAP_TIMEZONE=$TIMEZONE")
  fi
fi

# Add extra environment variables
if [ ${#EXTRA_ENVS[@]} -gt 0 ]; then
  for env in "${EXTRA_ENVS[@]}"; do
    CMD+=(-e "$env")
  done
fi

# Image
CMD+=("${IMAGE}:${IMAGE_TAG}")

# Run or print
echo "Platform:  $PLATFORM"
echo "Data dir:  $DATA_DIR"
echo "Port:      $PORT"
echo "Container: $CONTAINER_NAME"
echo "Image:     ${IMAGE}:${IMAGE_TAG}"
if [ "$TZ_EXPLICIT" = true ]; then
  echo "Timezone:  (set explicitly via --env)"
elif [ -n "$TIMEZONE" ]; then
  echo "Timezone:  $TIMEZONE (detected)"
else
  echo "Timezone:  UTC (could not detect host timezone)"
fi
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "Dry run — would execute:"
  echo "  ${CMD[*]}"
else
  # Check if container already exists
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    echo "Container '$CONTAINER_NAME' already exists."
    if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
      echo "It's already running. Use 'docker stop $CONTAINER_NAME && docker rm $CONTAINER_NAME' to recreate."
    else
      echo "Starting existing container..."
      docker start "$CONTAINER_NAME"
    fi
    exit 0
  fi

  echo "Starting Quilltap..."
  "${CMD[@]}"
  echo ""
  echo "Quilltap is running at http://localhost:${PORT}"
fi
