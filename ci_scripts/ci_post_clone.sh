#!/bin/sh

# ci_post_clone.sh — Xcode Cloud runs this immediately after cloning the repo.
#
# This is a Capacitor app: the web build (www/), CocoaPods (ios/App/Pods), and
# node_modules/ are all gitignored, so a fresh Xcode Cloud checkout is missing
# everything the Xcode workspace needs. We regenerate them here BEFORE Xcode
# resolves dependencies and builds the App scheme.

set -e

# Xcode Cloud runs custom scripts from the ci_scripts/ directory; move to the repo root.
cd "$CI_PRIMARY_REPOSITORY_PATH"

echo "→ Node/npm"
if ! command -v node >/dev/null 2>&1; then
  echo "  installing Node via Homebrew…"
  brew install node
fi
node --version
npm --version

echo "→ CocoaPods (used by 'cap sync' → 'pod install')"
if ! command -v pod >/dev/null 2>&1; then
  echo "  installing CocoaPods via Homebrew…"
  brew install cocoapods
fi
pod --version

echo "→ Installing npm dependencies"
npm ci

echo "→ Building web assets (www/) and syncing the native iOS project"
# npm run sync = 'npm run www' (assemble www/) + 'npx cap sync' (copy www/ + pod install)
npm run sync

echo "✅ ci_post_clone complete — www/ and Pods are ready for the build."
