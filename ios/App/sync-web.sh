#!/bin/sh
# Xcode build phase: copy the latest web game (index.html, css, js, icons) into the app on every build,
# so pressing Run in Xcode never ships stale game code. Same as `npm run www && npx cap copy ios`.
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "${SRCROOT}/../.."
if ! command -v node >/dev/null 2>&1; then
  echo "warning: node not found; the web app was not re-synced (run: npm run www && npx cap copy ios)"
  exit 0
fi
node scripts/sync-www.js >/dev/null
npx --no-install cap copy ios >/dev/null
echo "Synced the web app into ios/App/App/public"
