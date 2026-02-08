#!/bin/sh
set -eu

if [ ! -d node_modules ]; then
  echo "[start] installing dependencies..."
  npm install
fi

echo "[start] running migrations..."
node src/scripts/migrate.js

if [ "${TELEGRAM_WEBHOOK_URL:-}" != "" ]; then
  if [ "${TELEGRAM_BOT_TOKEN:-}" = "" ]; then
    echo "[start] TELEGRAM_WEBHOOK_URL is set but TELEGRAM_BOT_TOKEN is empty; skipping webhook setup"
  else
    echo "[start] setting telegram webhook..."
    i=1
    while [ $i -le 5 ]; do
      if node src/scripts/webhook.js set; then
        break
      fi
      echo "[start] webhook:set failed, retry $i/5..."
      i=$((i + 1))
      sleep 2
    done

    echo "[start] webhook info:"
    node src/scripts/webhook.js info || true
  fi
else
  echo "[start] TELEGRAM_WEBHOOK_URL is empty; starting in long polling mode"
fi

echo "[start] starting app..."
if [ "${APP_START_CMD:-}" != "" ]; then
  exec sh -lc "$APP_START_CMD"
fi

exec npm start
