#!/usr/bin/env bash
#
# concierge-four-state-test.sh
# ---------------------------------------------------------------------------
# Acceptance checks for the Concierge per-chat danger-status four-state:
#
#   CT-1  Sidebar four-state control    (Monitored / Flagged / Vouched Safe /
#                                        Uncensored)
#   CT-2  Operator states stay put      (no auto-override out of Vouched Safe
#                                        or Uncensored)
#   CT-3  State chosen at creation       (New Chat form's Concierge picker →
#                                        POST /api/v1/chats conciergeState)
#
# How it works (and why):
#   * State changes go through the HTTP PUT API — the exact code path the
#     Chat Sidebar uses (applyConciergeFlip). The Next.js server is the sole
#     DB writer, so we never write to the encrypted DB directly.
#   * Assertions are READ-ONLY quilltap CLI queries (`db --json`).
#   * The pill in the Salon header is a pure derivation of
#     (conciergeOverride, isDangerousChat) — verifying that pair verifies
#     what the pill will render.
#   * CT-2's "scheduled-danger-scan skips it" is an absence-over-time fact, so
#     it's checked with --arm (stamp a baseline) / --recheck (after a real
#     ~10-min scan tick). CT-2's "chat-danger-classification bails at handler
#     entry" can't be forced from the CLI without writing to the live DB, so
#     it's covered by the existing jest guard suites (deterministic).
#
# Requires: a running dev server (npm run dev), jq, and the quilltap CLI.
#
# WARNING: each full run appends ~15 synthetic Concierge bubbles to the target
#          chat's history (they're honest "mode changed" announcements, but
#          they accumulate). Point this at a THROWAWAY / test chat, not a
#          conversation you care about. The chat's effective state is restored
#          at the end unless --keep is given.
#
# Usage:
#   scripts/concierge-four-state-test.sh --chat <chatId> [options]
#
#   --chat <id>        Target chat UUID (required; or set $CHAT, or pass first arg)
#   --instance <name>  Quilltap instance (default: Friday)
#   --base-url <url>   Server base URL (default: http://localhost:3000)
#   --dry-run          Preflight + show current state + planned transitions; no writes
#   --arm              CT-2 scan-skip: set an operator state, stamp a baseline, exit
#   --recheck          CT-2 scan-skip: verify no scan-enqueued job since the baseline
#   --no-jest          Skip the CT-2 jest guard suites
#   --no-ct3           Skip CT-3 (which creates and then deletes throwaway chats)
#   --keep             Don't restore the chat's original state at the end
#   -h, --help         This help
# ---------------------------------------------------------------------------

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_JS="$ROOT/packages/quilltap/bin/quilltap.js"

INSTANCE="Friday"
BASE_URL="http://localhost:3000"
CHAT="${CHAT:-}"
MODE="run"          # run | dry | arm | recheck
RUN_JEST=1
RUN_CT3=1
RESTORE=1
DELAY="0.3"         # small settle after each PUT before reading via the CLI connection

# ----- arg parsing ---------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --chat)      CHAT="$2"; shift 2 ;;
    --instance)  INSTANCE="$2"; shift 2 ;;
    --base-url)  BASE_URL="$2"; shift 2 ;;
    --dry-run)   MODE="dry"; shift ;;
    --arm)       MODE="arm"; shift ;;
    --recheck)   MODE="recheck"; shift ;;
    --no-jest)   RUN_JEST=0; shift ;;
    --no-ct3)    RUN_CT3=0; shift ;;
    --keep)      RESTORE=0; shift ;;
    -h|--help)   sed -n '2,53p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)          echo "Unknown option: $1" >&2; exit 2 ;;
    *)           CHAT="$1"; shift ;;
  esac
done

# ----- pretty output -------------------------------------------------------
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_BAD=$'\033[31m'; C_DIM=$'\033[2m'; C_HDR=$'\033[1;36m'; C_RST=$'\033[0m'
else
  C_OK=""; C_BAD=""; C_DIM=""; C_HDR=""; C_RST=""
fi
PASS=0; FAIL=0
ok()      { PASS=$((PASS+1)); printf "  %s✓%s %s\n" "$C_OK" "$C_RST" "$1"; }
bad()     { FAIL=$((FAIL+1)); printf "  %s✗%s %s\n" "$C_BAD" "$C_RST" "$1"; }
info()    { printf "  %s· %s%s\n" "$C_DIM" "$1" "$C_RST"; }
section() { printf "\n%s== %s ==%s\n" "$C_HDR" "$1" "$C_RST"; }
die()     { printf "%sERROR:%s %s\n" "$C_BAD" "$C_RST" "$1" >&2; exit 1; }

# ----- CLI / query helpers (read-only) -------------------------------------
q()  { node "$CLI_JS" db --instance "$INSTANCE" --json "$1" 2>/dev/null; }
# scalar query: every query must alias its single column as `v`
qv() { local out; out="$(q "$1" | jq -r '.[0].v // "null"')"; [ "$out" = "null" ] && out="null"; printf '%s' "$out"; }

ov_of()  { qv "SELECT conciergeOverride AS v FROM chats WHERE id='$CHAT'"; }
dg_of()  { qv "SELECT isDangerousChat AS v FROM chats WHERE id='$CHAT'"; }
ann_marker() { qv "SELECT COALESCE(MAX(createdAt),'') AS v FROM chat_messages WHERE chatId='$CHAT' AND systemSender='concierge'"; }

derived_pill() { # ov dg -> pill label (Monitored renders no pill)
  if [ "$1" = "OFF" ]; then echo "Vouched Safe"
  elif [ "$1" = "UNCENSORED" ]; then echo "Uncensored"
  elif [ "$2" = "1" ]; then echo "Flagged"
  else echo "(none)"; fi
}
effective_state() { # ov dg -> monitored|flagged|vouched|uncensored
  if [ "$1" = "OFF" ]; then echo vouched
  elif [ "$1" = "UNCENSORED" ]; then echo uncensored
  elif [ "$2" = "1" ]; then echo flagged
  else echo monitored; fi
}

# ----- API driver (the only writer; server-mediated) -----------------------
api_set_state() { # state
  local state="$1" code
  if [ "$MODE" = "dry" ]; then info "[dry] would PUT conciergeState=$state"; return 0; fi
  code="$(curl -s -o /tmp/ct_resp.json -w '%{http_code}' \
            -X PUT "$BASE_URL/api/v1/chats/$CHAT" \
            -H 'Content-Type: application/json' \
            -d "{\"conciergeState\":\"$state\"}")"
  [ "$code" = "200" ] || { bad "PUT conciergeState=$state -> HTTP $code"; return 1; }
  sleep "$DELAY"
  return 0
}

# ----- assertions ----------------------------------------------------------
check_pair() { # expected_ov expected_dg label
  local ov dg pill
  ov="$(ov_of)"; dg="$(dg_of)"; pill="$(derived_pill "$ov" "$dg")"
  if [ "$ov" = "$1" ] && [ "$dg" = "$2" ]; then
    ok "$3 — (conciergeOverride=$ov, isDangerousChat=$dg) → pill: $pill"
  else
    bad "$3 — expected (ov=$1, dg=$2), got (ov=$ov, dg=$dg)"
  fi
}

check_ann() { # phrase since_iso label
  local n; n="$(qv "SELECT COUNT(*) AS v FROM chat_messages WHERE chatId='$CHAT' AND systemSender='concierge' AND content LIKE '%$1%' AND createdAt > '$2'")"
  [ "$n" = "null" ] && n=0
  if [ "$n" -ge 1 ] 2>/dev/null; then
    ok "$3 — Concierge announcement posted (\"…$1…\")"
  else
    bad "$3 — no Concierge announcement matching \"$1\""
  fi
}

transition() { # state expected_ov expected_dg phrase label
  local m; m="$(ann_marker)"
  api_set_state "$1" || return
  check_pair "$2" "$3" "$5: DB pair"
  [ -n "$4" ] && check_ann "$4" "$m" "$5: announcement"
}

# ----- preflight -----------------------------------------------------------
preflight() {
  command -v jq  >/dev/null || die "jq not found"
  [ -f "$CLI_JS" ] || die "quilltap CLI not found at $CLI_JS"
  [ -n "$CHAT" ]   || die "no --chat given. Find one: node packages/quilltap/bin/quilltap.js db --instance $INSTANCE find chat \"<name>\""
  local code; code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/health")"
  [ "$code" = "200" ] || die "server not reachable at $BASE_URL (HTTP $code). Is 'npm run dev' running?"
  local title; title="$(qv "SELECT title AS v FROM chats WHERE id='$CHAT'")"
  [ "$title" = "null" ] && die "chat '$CHAT' not found in instance '$INSTANCE'"
  printf "%sConcierge four-state test%s\n" "$C_HDR" "$C_RST"
  info "instance=$INSTANCE  base=$BASE_URL"
  info "chat=$CHAT  (\"$title\")"
}

# ----- CT-2 scan-skip baseline modes --------------------------------------
BASELINE_FILE="${TMPDIR:-/tmp}/ct-scan-baseline-$CHAT.json"

arm_scan() {
  preflight
  section "CT-2 scan-skip: arm baseline (Uncensored — the new state must skip too)"
  api_set_state uncensored || die "could not set chat Uncensored"
  check_pair "UNCENSORED" "$(dg_of)" "Uncensored confirmed"   # dg preserved, whatever it is
  local maxj now
  maxj="$(qv "SELECT COALESCE(MAX(createdAt),'') AS v FROM background_jobs WHERE type='CHAT_DANGER_CLASSIFICATION' AND payload LIKE '%$CHAT%'")"
  now="$(qv "SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS v")"
  printf '{"chat":"%s","maxJob":"%s","armedAt":"%s"}\n' "$CHAT" "$maxj" "$now" > "$BASELINE_FILE"
  ok "baseline stamped → $BASELINE_FILE"
  info "Leave the server running ≥10 min (the scan ticks every 10 min), then: $0 --chat $CHAT --recheck"
}

recheck_scan() {
  preflight
  section "CT-2 scan-skip: recheck"
  [ -f "$BASELINE_FILE" ] || die "no baseline ($BASELINE_FILE). Run --arm first."
  local maxj armedAt n ov dg
  maxj="$(jq -r .maxJob "$BASELINE_FILE")"; armedAt="$(jq -r .armedAt "$BASELINE_FILE")"
  ov="$(ov_of)"; dg="$(dg_of)"
  case "$ov" in
    OFF|UNCENSORED) ok "still operator-decided (conciergeOverride=$ov, isDangerousChat=$dg)" ;;
    *) bad "no longer operator-decided (conciergeOverride=$ov) — something flipped it!" ;;
  esac
  n="$(qv "SELECT COUNT(*) AS v FROM background_jobs WHERE type='CHAT_DANGER_CLASSIFICATION' AND payload LIKE '%$CHAT%' AND createdAt > '$maxj'")"
  [ "$n" = "null" ] && n=0
  if [ "$n" -eq 0 ] 2>/dev/null; then
    ok "scheduled scan enqueued NO classification job for this operator-decided chat since $armedAt"
  else
    bad "scan enqueued $n classification job(s) for an operator-decided chat — scan-skip FAILED"
  fi
  info "(If the server hasn't been up ≥10 min since arming, the scan may not have ticked yet — re-run later.)"
}

# ----- CT-3: the state chosen on the New Chat form ------------------------
#
# The Concierge picker moved onto the creation form, so `POST /api/v1/chats`
# now takes a `conciergeState`. The route applies it through the same
# `applyConciergeFlip` chokepoint the sidebar uses, between the SYSTEM prompt
# message and everything else — so the created chat must carry the right stored
# pair AND exactly one Concierge bubble, sitting after the prompt and before
# the opening line. Every assertion is a read-only CLI query; the throwaway
# chats are deleted through the API afterwards.

# Expected (conciergeOverride, isDangerousChat) for a chat CREATED in a state.
# The flag is only written by the Flagged branch; Vouched Safe and Uncensored
# preserve whatever was underneath, which on a fresh row is nothing — so
# "unflagged" is spelled `unset` and satisfied by either NULL or 0.
ct3_state_pair() { # state -> "ov dg"
  case "$1" in
    flagged)    echo "null 1" ;;
    vouched)    echo "OFF unset" ;;
    uncensored) echo "UNCENSORED unset" ;;
    *)          echo "null unset" ;;
  esac
}

dg_matches() { # expected actual
  if [ "$1" = "unset" ]; then
    [ "$2" = "null" ] || [ "$2" = "0" ]
  else
    [ "$1" = "$2" ]
  fi
}

ct3_create_chat() { # characterId profileId state ("" for "omit the field") -> new chat id
  local body id
  body="$(printf '{"title":"CT-3 throwaway","participants":[{"type":"CHARACTER","characterId":"%s","connectionProfileId":"%s","controlledBy":"llm"}]%s}' \
            "$1" "$2" "$( [ -n "$3" ] && printf ',"conciergeState":"%s"' "$3" )")"
  id="$(curl -s -X POST "$BASE_URL/api/v1/chats" \
          -H 'Content-Type: application/json' -d "$body" | jq -r '.chat.id // empty')"
  printf '%s' "$id"
}

ct3_delete_chat() { # chatId
  curl -s -o /dev/null -X DELETE "$BASE_URL/api/v1/chats/$1"
}

ct3_case() { # state characterId profileId
  local state="$1" charId="$2" profId="$3" newId pair exp_ov exp_dg ov dg n sys_rid con_rid
  newId="$(ct3_create_chat "$charId" "$profId" "$state")"
  if [ -z "$newId" ]; then
    bad "CT-3 $state: POST /api/v1/chats returned no chat"
    return
  fi

  pair="$(ct3_state_pair "$state")"; exp_ov="${pair%% *}"; exp_dg="${pair##* }"
  ov="$(qv "SELECT conciergeOverride AS v FROM chats WHERE id='$newId'")"
  dg="$(qv "SELECT isDangerousChat AS v FROM chats WHERE id='$newId'")"
  if [ "$ov" = "$exp_ov" ] && dg_matches "$exp_dg" "$dg"; then
    ok "CT-3 $state: created with (conciergeOverride=$ov, isDangerousChat=$dg) → pill: $(derived_pill "$ov" "$dg")"
  else
    bad "CT-3 $state: expected (ov=$exp_ov, dg=$exp_dg), got (ov=$ov, dg=$dg)"
  fi

  n="$(qv "SELECT COUNT(*) AS v FROM chat_messages WHERE chatId='$newId' AND systemSender='concierge'")"
  [ "$n" = "null" ] && n=0
  if [ "$n" = "1" ]; then
    ok "CT-3 $state: exactly one Concierge bubble in the fresh history"
  else
    bad "CT-3 $state: expected 1 Concierge bubble, found $n"
  fi

  # rowid is insertion order on a SQLite rowid table — the SYSTEM prompt is
  # written first, the Concierge's note second, the scene after that.
  sys_rid="$(qv "SELECT MIN(rowid) AS v FROM chat_messages WHERE chatId='$newId' AND role='SYSTEM'")"
  con_rid="$(qv "SELECT MIN(rowid) AS v FROM chat_messages WHERE chatId='$newId' AND systemSender='concierge'")"
  if [ "$sys_rid" != "null" ] && [ "$con_rid" != "null" ] && [ "$con_rid" -gt "$sys_rid" ] 2>/dev/null; then
    ok "CT-3 $state: the Concierge's note follows the system prompt"
  else
    bad "CT-3 $state: bubble placement wrong (system rowid=$sys_rid, concierge rowid=$con_rid)"
  fi

  ct3_delete_chat "$newId"
  info "CT-3 $state: throwaway chat $newId deleted"
}

run_ct3() {
  section "CT-3: the state chosen on the New Chat form (creation-time)"
  local charId profId newId n ov dg
  charId="$(qv "SELECT id AS v FROM characters WHERE controlledBy='llm' AND archivedAt IS NULL ORDER BY createdAt LIMIT 1")"
  profId="$(qv "SELECT id AS v FROM connection_profiles ORDER BY createdAt LIMIT 1")"
  if [ "$charId" = "null" ] || [ "$profId" = "null" ]; then
    info "skipped — instance '$INSTANCE' has no LLM character and/or connection profile to build a chat from"
    return
  fi
  info "cast: character=$charId profile=$profId (chats are created and then deleted)"

  # Absence is the default: a plain create must stay exactly what it was.
  newId="$(ct3_create_chat "$charId" "$profId" "")"
  if [ -z "$newId" ]; then
    bad "CT-3 omitted: POST /api/v1/chats returned no chat"
  else
    n="$(qv "SELECT COUNT(*) AS v FROM chat_messages WHERE chatId='$newId' AND systemSender='concierge'")"
    [ "$n" = "null" ] && n=0
    ov="$(qv "SELECT conciergeOverride AS v FROM chats WHERE id='$newId'")"
    dg="$(qv "SELECT isDangerousChat AS v FROM chats WHERE id='$newId'")"
    if [ "$ov" = "null" ] && dg_matches unset "$dg" && [ "$n" = "0" ]; then
      ok "CT-3 omitted: created Monitored, no Concierge bubble"
    else
      bad "CT-3 omitted: expected Monitored with no bubble, got (ov=$ov, dg=$dg, bubbles=$n)"
    fi
    ct3_delete_chat "$newId"
  fi

  ct3_case flagged    "$charId" "$profId"
  ct3_case vouched    "$charId" "$profId"
  ct3_case uncensored "$charId" "$profId"
}

# ----- jest guard suites (CT-2 bail + derivation) --------------------------
run_jest() {
  section "CT-2 guard suites (read-only, deterministic)"
  local suites=(
    "__tests__/unit/lib/services/dangerous-content/manual-flip.test.ts"
    "__tests__/unit/lib/services/dangerous-content/chat-override.test.ts"
    "__tests__/unit/lib/services/dangerous-content/resolver.test.ts"
    "__tests__/unit/background-jobs/chat-danger-classification.test.ts"
  )
  if (cd "$ROOT" && npx jest "${suites[@]}" --silent >/tmp/ct_jest.log 2>&1); then
    ok "manual-flip + chat-override + resolver + chat-danger-classification suites passed"
    info "covers: four-state → (override,flag) writes & announcements, predicates, resolver overrides, handler bail"
  else
    bad "guard suites failed — see /tmp/ct_jest.log (if native ABI mismatch: npm rebuild better-sqlite3)"
  fi
}

# ----- main runs -----------------------------------------------------------
case "$MODE" in
  arm)     arm_scan; exit 0 ;;
  recheck) recheck_scan; exit 0 ;;
esac

preflight

ORIG_OV="$(ov_of)"; ORIG_DG="$(dg_of)"; ORIG_STATE="$(effective_state "$ORIG_OV" "$ORIG_DG")"
info "original state: $ORIG_STATE (ov=$ORIG_OV, dg=$ORIG_DG)"

if [ "$MODE" = "dry" ]; then
  section "DRY RUN — plumbing check, no writes"
  ok "server reachable, CLI queryable, chat found"
  check_pair "$ORIG_OV" "$ORIG_DG" "current pair readable"
  info "planned CT-1 walk: monitored → flagged → monitored → vouched → monitored → uncensored → monitored → flagged → vouched → uncensored"
  info "planned CT-2: flagged → vouched (preserve flag) → uncensored (preserve flag), then jest guards"
  info "planned CT-3: create+delete four throwaway chats (omitted, flagged, vouched, uncensored)"
  printf "\n%sDry run OK.%s Re-run without --dry-run to execute (mutates the chat).\n" "$C_OK" "$C_RST"
  exit 0
fi

printf "\n%s⚠ This appends synthetic Concierge bubbles to chat %s. Ctrl-C within 3s to abort.%s\n" "$C_BAD" "$CHAT" "$C_RST"
sleep 3

# normalize to a known starting point (unasserted setup)
api_set_state monitored >/dev/null 2>&1 || true

section "CT-1: sidebar four-state control"
#          state      ov         dg  announce-phrase              label
transition flagged    null       1   "thrown the switch"          "Monitored→Flagged"
transition monitored  null       0   "stands down for the moment" "Flagged→Monitored"
transition vouched    OFF        0   "takes the afternoon off"    "Monitored→Vouched Safe (flag preserved=0)"
transition monitored  null       0   "returns to his post"        "Vouched Safe→Monitored"
transition uncensored UNCENSORED 0   "uncensored door stands open" "Monitored→Uncensored (flag preserved=0)"
transition monitored  null       0   "returns to his post"        "Uncensored→Monitored"
transition flagged    null       1   ""                           "Monitored→Flagged (setup)"
transition vouched    OFF        1   "takes the afternoon off"    "Flagged→Vouched Safe (flag preserved=1)"
transition uncensored UNCENSORED 1   "uncensored door stands open" "Vouched Safe→Uncensored (flag preserved=1)"
transition flagged    null       1   "thrown the switch"          "Uncensored→Flagged"

section "CT-2: operator states stay put (live, deterministic parts)"
transition vouched    OFF        1   "takes the afternoon off"    "→Vouched Safe preserves Flagged"
check_pair "OFF" "1" "Vouched Safe is stable (override wins, flag preserved underneath)"
transition uncensored UNCENSORED 1   "uncensored door stands open" "→Uncensored preserves Flagged"
check_pair "UNCENSORED" "1" "Uncensored is stable (override wins, flag preserved underneath)"
info "scan-skip over a live 10-min tick: run '$0 --chat $CHAT --arm' then '--recheck' later"

[ "$RUN_CT3" -eq 1 ] && run_ct3
[ "$RUN_JEST" -eq 1 ] && run_jest

# restore
if [ "$RESTORE" -eq 1 ]; then
  section "restore"
  api_set_state "$ORIG_STATE" >/dev/null 2>&1 && info "restored effective state → $ORIG_STATE" \
    || info "could not restore (left as-is)"
fi

# ----- summary -------------------------------------------------------------
printf "\n%s──────── %d passed, %d failed ────────%s\n" \
  "$([ "$FAIL" -eq 0 ] && echo "$C_OK" || echo "$C_BAD")" "$PASS" "$FAIL" "$C_RST"
[ "$FAIL" -eq 0 ]
