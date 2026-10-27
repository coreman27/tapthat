#!/usr/bin/env bash
# Ships a build to App Store Connect / TestFlight in one command: bump the build number, run the tests, sync the
# web app into iOS, archive, upload, commit the bump. Same rules as Tableside:
#
#   - The build number goes up on EVERY upload (1.1.0 (16), 1.1.0 (17), ...). App Store Connect refuses a repeat.
#   - The version stays put unless asked: --next-version (1.1.0 -> 1.2.0) or --version 1.2.0.
#   - Builds come from a clean, pushed main.
#
#   ./scripts/testflight.sh                   same version, next build number, full test suite
#   ./scripts/testflight.sh --next-version    next minor version (1.1.0 -> 1.2.0), next build number
#   ./scripts/testflight.sh --version 1.2.0   a specific version, next build number
#   ./scripts/testflight.sh --build 20        a specific build number
#   ./scripts/testflight.sh --skip-tests      when the suite already ran on this commit
#   ./scripts/testflight.sh --no-commit       leave the bump uncommitted
#
# Credentials: an App Store Connect API key (team-wide, so Tableside's works here too), read from
# ~/.config/tapthat/testflight.env, else ~/.config/tableside/testflight.env:
#   ASC_KEY_ID=ABC123DEF4
#   ASC_ISSUER_ID=12345678-aaaa-bbbb-cccc-1234567890ab
#   ASC_KEY_PATH=$HOME/.private_keys/AuthKey_ABC123DEF4.p8
set -euo pipefail
cd "$(dirname "$0")/.."

build=""
new_version=""
next_version=0
run_tests=1
commit=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) build="${2:?--build needs a number}"; shift 2 ;;
    --version) new_version="${2:?--version needs e.g. 1.2.0}"; shift 2 ;;
    --next-version) next_version=1; shift ;;
    --skip-tests) run_tests=0; shift ;;
    --no-commit) commit=0; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

PBX=ios/App/App.xcodeproj/project.pbxproj
WORKSPACE=ios/App/App.xcworkspace
EXPORT_OPTIONS=ios/App/ExportOptions.plist

# --- credentials -------------------------------------------------------------------------------------------
env_file="${TESTFLIGHT_ENV:-}"
if [[ -z "$env_file" ]]; then
  for f in "$HOME/.config/tapthat/testflight.env" "$HOME/.config/tableside/testflight.env"; do
    [[ -f "$f" ]] && { env_file="$f"; break; }
  done
fi
[[ -n "$env_file" && -f "$env_file" ]] || die "no testflight.env (see the top of this script)"
# shellcheck disable=SC1090
source "$env_file"
: "${ASC_KEY_ID:?ASC_KEY_ID missing from $env_file}"
: "${ASC_ISSUER_ID:?ASC_ISSUER_ID missing from $env_file}"
: "${ASC_KEY_PATH:?ASC_KEY_PATH missing from $env_file}"
[[ -f "$ASC_KEY_PATH" ]] || die "API key file not found: $ASC_KEY_PATH"

# --- preflight ---------------------------------------------------------------------------------------------
git fetch -q origin main
git merge-base --is-ancestor HEAD origin/main || die "HEAD is not on origin/main; builds come from pushed main commits"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  die "uncommitted changes in the working tree; commit them so the build matches a commit"
fi

# --- version and build number (both Debug and Release in the Xcode project) ----------------------------------
current=$(sed -nE 's/^[[:space:]]*CURRENT_PROJECT_VERSION = ([0-9]+);/\1/p' "$PBX" | sort -n | tail -1)
[[ -n "$current" ]] || die "CURRENT_PROJECT_VERSION not found in $PBX"
current_version=$(sed -nE 's/^[[:space:]]*MARKETING_VERSION = ([0-9.]+);/\1/p' "$PBX" | head -1)
[[ -n "$current_version" ]] || die "MARKETING_VERSION not found in $PBX"
[[ -z "$new_version" || $next_version -eq 0 ]] || die "--version and --next-version don't go together"

if [[ -n "$new_version" ]]; then
  version="$new_version"
elif [[ $next_version -eq 1 ]]; then
  major="${current_version%%.*}"; rest="${current_version#*.}"; minor="${rest%%.*}"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || die "can't bump version '$current_version'; pass --version"
  version="$major.$((minor + 1)).0"
else
  version="$current_version"
fi
[[ "$version" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || die "version must look like 1.2 or 1.2.0, got '$version'"
if [[ "$version" != "$current_version" ]]; then
  [[ "$(printf '%s\n%s\n' "$current_version" "$version" | sort -V | tail -1)" == "$version" ]] \
    || die "version $version is not above the current $current_version"
fi

if [[ -z "$build" ]]; then build=$((current + 1)); fi
[[ "$build" =~ ^[0-9]+$ ]] || die "build number must be an integer"
[[ "$build" -gt "$current" ]] || die "build $build is not above the current $current"

say "Build $version ($build), was $current_version ($current)"
sed -i '' -E "s/(MARKETING_VERSION = )[0-9.]+;/\1$version;/" "$PBX"
sed -i '' -E "s/(CURRENT_PROJECT_VERSION = )[0-9]+;/\1$build;/" "$PBX"

restore_bump() { git checkout -- "$PBX"; echo "version bump reverted"; }

# --- tests -------------------------------------------------------------------------------------------------
if [[ $run_tests -eq 1 ]]; then
  say "Tests"
  npm test >/dev/null 2>&1 || { npm test 2>&1 | grep -E "✖|✗" | head -20; restore_bump; die "tests failed; nothing uploaded"; }
fi

# --- web app into iOS --------------------------------------------------------------------------------------
say "Syncing the web app into the iOS project"
npm run www --silent >/dev/null
npx cap sync ios >/dev/null 2>&1 || { restore_bump; die "npx cap sync ios failed"; }

# --- archive -----------------------------------------------------------------------------------------------
archive_dir="build/archives"
archive="$archive_dir/DontTapThat-$version-$build.xcarchive"
mkdir -p "$archive_dir"
rm -rf "$archive"
auth=(-allowProvisioningUpdates
      -authenticationKeyPath "$ASC_KEY_PATH"
      -authenticationKeyID "$ASC_KEY_ID"
      -authenticationKeyIssuerID "$ASC_ISSUER_ID")

say "Archiving (a few minutes)"
log="$archive_dir/archive-$build.log"
if ! xcodebuild archive \
    -workspace "$WORKSPACE" -scheme App -configuration Release \
    -destination 'generic/platform=iOS' -archivePath "$archive" "${auth[@]}" > "$log" 2>&1; then
  grep -E "error:" "$log" | head -20
  restore_bump; die "archive failed (full log: $log)"
fi

# --- upload ------------------------------------------------------------------------------------------------
say "Uploading to App Store Connect (validates on the way)"
export_dir="$archive_dir/export-$build"
rm -rf "$export_dir"
log="$archive_dir/upload-$build.log"
if ! xcodebuild -exportArchive \
    -archivePath "$archive" -exportOptionsPlist "$EXPORT_OPTIONS" -exportPath "$export_dir" \
    "${auth[@]}" > "$log" 2>&1; then
  grep -E "error:|error " "$log" | head -20
  restore_bump; die "upload failed (full log: $log). If App Store Connect already shows build $build, rerun with --build $((build + 1))"
fi

# --- record it ---------------------------------------------------------------------------------------------
if [[ $commit -eq 1 ]]; then
  say "Committing the bump"
  git add "$PBX"
  git commit -q -m "Build $version ($build) to App Store Connect"
  git push -q origin HEAD:main
fi

cat <<MSG

Build $version ($build) is uploading. What happens next:
  - App Store Connect emails you when processing finishes (5–30 min).
  - No "Missing Compliance" question: Info.plist declares no non-exempt encryption.
  - TestFlight: internal testers get it if the group has automatic distribution on.
  - App Store: on the version page, Build → + → $version ($build), then Add for Review.
MSG
