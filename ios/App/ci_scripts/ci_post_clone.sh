#!/bin/sh

# ci_post_clone.sh — Xcode Cloud runs this after cloning the repo.
#
# LOCATION: Xcode Cloud only detects ci_scripts when it sits in the SAME
# directory as the Xcode project/workspace. This app's workspace is at
# ios/App/App.xcworkspace, so this script lives at ios/App/ci_scripts/.
#
# This is a Capacitor app: the web build (www/), CocoaPods (ios/App/Pods), and
# node_modules/ are gitignored, so a fresh checkout is missing everything the
# workspace needs. We regenerate them here BEFORE Xcode resolves dependencies
# and archives. If Pods are missing the archive fails with "Unable to open base
# configuration reference file .../Pods-App.release.xcconfig", so we verify the
# Pods xcconfig exists before finishing.

set -ex

# Resolve the repository root (where package.json lives). Prefer Xcode Cloud's
# env var; fall back to git; finally walk up from this script's location.
if [ -n "$CI_PRIMARY_REPOSITORY_PATH" ] && [ -f "$CI_PRIMARY_REPOSITORY_PATH/package.json" ]; then
  REPO_ROOT="$CI_PRIMARY_REPOSITORY_PATH"
else
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  REPO_ROOT="$(cd "$SCRIPT_DIR" && git rev-parse --show-toplevel 2>/dev/null)"
  if [ -z "$REPO_ROOT" ]; then
    REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
  fi
fi
cd "$REPO_ROOT"
echo "Repository root: $(pwd)"

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
