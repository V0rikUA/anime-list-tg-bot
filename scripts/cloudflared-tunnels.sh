#!/usr/bin/env bash
set -euo pipefail

FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
# Backwards-compatible: allow BACKEND_URL, but prefer GATEWAY_URL (microservices).
GATEWAY_URL="${GATEWAY_URL:-${BACKEND_URL:-http://localhost:8080}}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/.cloudflared-logs}"
mkdir -p "$LOG_DIR"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found in PATH. Install it first: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" >&2
  exit 127
fi

cleanup() {
  local code=$?
  echo
  echo "Stopping tunnels..."

  if [[ -n "${PID_WATCH_FRONTEND:-}" ]] && kill -0 "$PID_WATCH_FRONTEND" 2>/dev/null; then
    kill "$PID_WATCH_FRONTEND" 2>/dev/null || true
  fi
  if [[ -n "${PID_WATCH_BACKEND:-}" ]] && kill -0 "$PID_WATCH_BACKEND" 2>/dev/null; then
    kill "$PID_WATCH_BACKEND" 2>/dev/null || true
  fi

  # Try graceful first
  if [[ -n "${PID_FRONTEND:-}" ]] && kill -0 "$PID_FRONTEND" 2>/dev/null; then
    kill "$PID_FRONTEND" 2>/dev/null || true
  fi
  if [[ -n "${PID_BACKEND:-}" ]] && kill -0 "$PID_BACKEND" 2>/dev/null; then
    kill "$PID_BACKEND" 2>/dev/null || true
  fi

  # Wait a bit
  sleep 0.5 || true

  # Force if still alive
  if [[ -n "${PID_FRONTEND:-}" ]] && kill -0 "$PID_FRONTEND" 2>/dev/null; then
    kill -9 "$PID_FRONTEND" 2>/dev/null || true
  fi
  if [[ -n "${PID_BACKEND:-}" ]] && kill -0 "$PID_BACKEND" 2>/dev/null; then
    kill -9 "$PID_BACKEND" 2>/dev/null || true
  fi

  exit "$code"
}

trap cleanup INT TERM EXIT

TS="$(date +%Y%m%d-%H%M%S)"
LOG_FRONTEND="$LOG_DIR/frontend-$TS.log"
LOG_BACKEND="$LOG_DIR/gateway-$TS.log"
: >"$LOG_FRONTEND"
: >"$LOG_BACKEND"

echo "Starting cloudflared tunnels..."
echo "  Frontend: $FRONTEND_URL"
echo "  Gateway:  $GATEWAY_URL"
echo "Logs:"
echo "  $LOG_FRONTEND"
echo "  $LOG_BACKEND"
echo

start_tunnel() {
  local name="$1"
  local url="$2"
  local logfile="$3"

  cloudflared tunnel --url "$url" >"$logfile" 2>&1 &
  local pid=$!

  case "$name" in
    frontend)
      PID_FRONTEND="$pid"
      ;;
    gateway)
      PID_BACKEND="$pid"
      ;;
  esac
}

watch_url() {
  local name="$1"
  local logfile="$2"

  # Print only the public URL to keep console output clean.
  # Exits after the first match.
  tail -n 0 -f "$logfile" | perl -ne '
    BEGIN { $name = shift @ARGV; }
    if (m{(https?://\\S*trycloudflare\\.com\\S*)}) {
      print "[$name] Public URL: $1\n";
      exit 0;
    }
  ' "$name"
}

echo "[frontend] running: cloudflared tunnel --url $FRONTEND_URL"
start_tunnel "frontend" "$FRONTEND_URL" "$LOG_FRONTEND"
watch_url "frontend" "$LOG_FRONTEND" &
PID_WATCH_FRONTEND=$!

echo "[gateway]  running: cloudflared tunnel --url $GATEWAY_URL"
start_tunnel "gateway" "$GATEWAY_URL" "$LOG_BACKEND"
watch_url "gateway" "$LOG_BACKEND" &
PID_WATCH_BACKEND=$!

echo
echo "PIDs: frontend=$PID_FRONTEND gateway=$PID_BACKEND"
echo "Press Ctrl+C to stop both tunnels."
echo

wait "$PID_FRONTEND" "$PID_BACKEND"
