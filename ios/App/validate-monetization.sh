#!/bin/sh
set -eu

plist="${SRCROOT}/App/Info.plist"
read_key() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$plist"
}

enabled="$(read_key MonetizationAdsEnabled)"
test_ads="$(read_key MonetizationTestAds)"
app_id="$(read_key GADApplicationIdentifier)"
unit_id="$(read_key MonetizationInterstitialAdUnitID)"
rewarded_id="$(read_key MonetizationRewardedAdUnitID)"
product_id="$(read_key MonetizationRemoveAdsProductID)"

# Theme unlock products (optional; every entry must be a well-formed app-scoped id).
theme_index=0
while theme_id="$(/usr/libexec/PlistBuddy -c "Print :MonetizationThemeProductIDs:$theme_index" "$plist" 2>/dev/null)"; do
  if ! printf '%s\n' "$theme_id" | grep -Eq '^com\.coreyhall\.donttapthat\.theme\.[a-z0-9]+$'; then
    echo "error: Invalid theme product id: $theme_id"
    exit 1
  fi
  theme_index=$((theme_index + 1))
done

if [ -z "$product_id" ]; then
  echo "error: MonetizationRemoveAdsProductID must identify a non-consumable App Store product."
  exit 1
fi

if [ "${MONETIZATION_REQUIRE_PRODUCTION_ADS:-NO}" = "YES" ]; then
  if [ "$enabled" != "true" ] || [ "$test_ads" != "false" ]; then
    echo "error: This distribution build requires enabled production advertising, not test IDs."
    exit 1
  fi
fi

if [ "$enabled" != "true" ]; then
  exit 0
fi

if [ "$test_ads" = "true" ]; then
  if [ "$app_id" != "ca-app-pub-3940256099942544~1458002511" ] ||
     [ "$unit_id" != "ca-app-pub-3940256099942544/4411468910" ] ||
     [ "$rewarded_id" != "ca-app-pub-3940256099942544/1712485313" ]; then
    echo "error: Test mode requires Google's official iOS sample app, interstitial and rewarded IDs."
    exit 1
  fi
  if [ "${CONFIGURATION:-}" = "Release" ]; then
    echo "warning: Monetization uses test ads; this archive will not earn ad revenue."
  fi
else
  if ! printf '%s\n' "$app_id" | grep -Eq '^ca-app-pub-[0-9]{16}~[0-9]{10}$' ||
     ! printf '%s\n' "$unit_id" | grep -Eq '^ca-app-pub-[0-9]{16}/[0-9]{10}$' ||
     printf '%s\n%s\n%s\n' "$app_id" "$unit_id" "$rewarded_id" | grep -q '3940256099942544'; then
    echo "error: Production advertising requires your real AdMob IDs (no Google test IDs)."
    exit 1
  fi
  # The rewarded unit is optional in production: empty turns Rewarded Continue off for
  # non-owners. If set, it must be a real unit id.
  if [ -n "$rewarded_id" ] && ! printf '%s\n' "$rewarded_id" | grep -Eq '^ca-app-pub-[0-9]{16}/[0-9]{10}$'; then
    echo "error: MonetizationRewardedAdUnitID must be empty or a real AdMob rewarded unit id."
    exit 1
  fi
fi
