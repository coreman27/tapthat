#!/bin/sh

# ci_post_clone.sh — Xcode Cloud runs this immediately after cloning the repo.
#
# This is a Capacitor app: the web build (www/), CocoaPods (ios/App/Pods), and
# node_modules/ are all gitignored, so a fresh Xcode Cloud checkout is missing
# everything the Xcode workspace needs. We regenerate them here BEFORE Xcode
# resolves dependencies and archives the App scheme. If Pods are missing the
# archive fails with "Unable to open base configuration reference file
# .../Pods-App.release.xcconfig", so we verify Pods exist before finishing.

set -ex

# Xcode Cloud runs custom scripts from the ci_scripts/ directory. Prefer the
# documented repo-root env var, but fall back to ci_scripts/.. so this works
# regardless of the runner's working directory.
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_ROOT"
echo "Working directory: $(pwd)"

echo "-> Node/npm"
if ! command -v node >/dev/null 2>&1; then
  echo "  installing Node via Homebrew..."
  brew install node
fi
node --version
npm --version

echo "-> CocoaPods (used by 'cap sync' -> 'pod install')"
if ! command -v pod >/dev/null 2>&1; then
  echo "  installing CocoaPods via Homebrew..."
  brew install cocoapods
fi
pod --version

echo "-> Installing npm dependencies"
npm ci

echo "-> Building web assets (www/) and syncing the native iOS project"
# npm run sync = 'npm run www' (assemble www/) + 'npx cap sync' (copy www/ + pod install)
npm run sync

# Belt-and-suspenders: guarantee CocoaPods are installed for the App target.
XCCONFIG="ios/App/Pods/Target Support Files/Pods-App/Pods-App.release.xcconfig"
if [ ! -f "$XCCONFIG" ]; then
  echo "-> Pods not present after cap sync; running pod install directly"
  (cd ios/App && pod install --repo-update)
fi

# Fail loudly (instead of a confusing archive-time error) if Pods still missing.
if [ ! -f "$XCCONFIG" ]; then
  echo "ERROR: CocoaPods did not generate $XCCONFIG — the archive cannot succeed." >&2
  exit 1
fi

echo "ci_post_clone complete - www/ and Pods are ready for the build."
