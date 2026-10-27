#!/usr/bin/env bash
# App Store "Header and Search Results" images: renders the raw game screens with headless Chrome, then composes
# the 21:9 product-page header and the 3:2 search-results image (scripts/appstore-marketing.swift).
#   ./scripts/appstore-marketing.sh
# Output: store-screenshots/marketing/header-21x9.png (3840x1646) and search-3x2.png (3840x2560).
set -euo pipefail
cd "$(dirname "$0")/.."

node scripts/store-screenshots.js --marketing
raw=store-screenshots/marketing/raw
out=store-screenshots/marketing
swift scripts/appstore-marketing.swift "$out/header-21x9.png" 3840 1646 "$raw/tapcolor.png" "$raw/donttap.png" "$raw/game-over.png"
swift scripts/appstore-marketing.swift "$out/search-3x2.png" 3840 2560 "$raw/tapcolor.png" "$raw/donttap.png" "$raw/game-over.png"
