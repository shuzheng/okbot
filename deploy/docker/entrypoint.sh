#!/bin/sh
# Container entrypoint for `okbot serve`.
# - Forces bindLan so the process listens on 0.0.0.0 (published / Service ports work).
# - Tokens are minted on first serve and printed to stdout; retrieve later with
#   `okbot token show` (e.g. docker compose exec gateway okbot token show).
# - CLI contract: `okbot serve` requires --port and --data-dir as a pair (or neither).
#   When OKBOT_DATA_DIR is set we therefore also pass --port (OKBOT_PORT or 18765).
# - Listen port: OKBOT_PORT (default 18765). Image HEALTHCHECK / compose / Helm must
#   target the same value (see Dockerfile ENV, compose substitution, service.targetPort).
set -eu

OKBOT_BIN="${OKBOT_BIN:-/app/bin/okbot.mjs}"
# Keep in sync with DEFAULT_GATEWAY_HTTP_API_PORT / Dockerfile ENV OKBOT_PORT.
OKBOT_PORT="${OKBOT_PORT:-18765}"

config_set() {
  if [ -n "${OKBOT_DATA_DIR:-}" ]; then
    node "$OKBOT_BIN" config set --data-dir "$OKBOT_DATA_DIR" "$@"
  else
    node "$OKBOT_BIN" config set "$@"
  fi
}

# Args for `okbot serve`. parseInstanceFlags requires --port + --data-dir together.
serve_args() {
  if [ -n "${OKBOT_DATA_DIR:-}" ]; then
    printf '%s\n' --port "$OKBOT_PORT" --data-dir "$OKBOT_DATA_DIR"
  fi
}

# Default: bind all interfaces inside the container.
case "${OKBOT_BIND_LAN:-true}" in
  1|true|TRUE|yes|YES|on|ON)
    # Explicit serve-ui false unless OKBOT_SERVE_UI=true — browser UI needs
    # apps/desktop/out/renderer assets, which this image does not ship.
    config_set --bind-lan true --serve-ui false
    ;;
esac

case "${OKBOT_SERVE_UI:-false}" in
  1|true|TRUE|yes|YES|on|ON)
    config_set --serve-ui true
    ;;
esac

# Persist listen port into server.json for the active data root (default or OKBOT_DATA_DIR).
# When OKBOT_DATA_DIR is unset, serve runs without --port and reads this value.
config_set --port "$OKBOT_PORT"

# Pass-through: `docker run … okbot-gateway token show` / `status` / etc.
if [ "$#" -gt 0 ]; then
  exec node "$OKBOT_BIN" "$@"
fi

# Default command: serve (with --port/--data-dir pair when OKBOT_DATA_DIR is set).
# shellcheck disable=SC2046
exec node "$OKBOT_BIN" serve $(serve_args)
