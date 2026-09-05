#!/bin/sh
# Quilltap Docker entrypoint script
# Execs the application so it becomes PID 1 and receives signals properly.

# Keep the two timezone knobs in lockstep before the app starts.
#
# QUILLTAP_TIMEZONE feeds the timestamp-formatting chain (lib/chat/timestamp-utils.ts),
# but several paths read Node's *system-local* clock instead: episodic day-references
# ("today"/"yesterday" recall windows), the autonomous-room daily budget rollover at
# instance-local midnight, and croner schedule evaluation. Those follow TZ, not
# QUILLTAP_TIMEZONE. A container that sets only one of the pair therefore ends up half
# on the user's clock and half on UTC.
#
# So: whichever is set fills in the other, and QUILLTAP_TIMEZONE wins when both are.
# No tzdata package is required; Node resolves TZ through its bundled ICU.
if [ -n "${QUILLTAP_TIMEZONE:-}" ]; then
  export TZ="$QUILLTAP_TIMEZONE"
elif [ -n "${TZ:-}" ]; then
  export QUILLTAP_TIMEZONE="$TZ"
fi

exec "$@"
