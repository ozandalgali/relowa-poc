#!/usr/bin/env bash
# scripts/wait-for-pg.sh
# Polls Postgres until it accepts connections or timeout.
# Used by CI before running migrations and tests.
#
# Usage: ./scripts/wait-for-pg.sh [host] [port] [timeout_seconds]
# Defaults: localhost 5433 60

set -euo pipefail

HOST="${1:-localhost}"
PORT="${2:-5433}"
TIMEOUT="${3:-60}"
INTERVAL=2
ELAPSED=0

echo "Waiting for Postgres at ${HOST}:${PORT} (timeout: ${TIMEOUT}s)..."

while true; do
  if pg_isready -h "$HOST" -p "$PORT" -q 2>/dev/null; then
    echo "Postgres is ready."
    exit 0
  fi

  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "Timeout waiting for Postgres after ${TIMEOUT}s."
    exit 1
  fi

  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
done
