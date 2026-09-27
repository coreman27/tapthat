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
product_id="$(read_key MonetizationRemoveAdsProductID)"

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
     [ "$unit_id" != "ca-app-pub-3940256099942544/4411468910" ]; then
    echo "error: Test mode requires Google's official iOS sample app and interstitial IDs."
    exit 1
  fi
  if [ "${CONFIGURATION:-}" = "Release" ]; then
    echo "warning: Monetization uses test ads; this archive will not earn ad revenue."
  fi
else
  if ! printf '%s\n' "$app_id" | grep -Eq '^ca-app-pub-[0-9]{16}~[0-9]{10}$' ||
     ! printf '%s\n' "$unit_id" | grep -Eq '^ca-app-pub-[0-9]{16}/[0-9]{10}$' ||
     printf '%s\n%s\n' "$app_id" "$unit_id" | grep -q '3940256099942544'; then
    echo "error: Production advertising requires your real AdMob app and interstitial IDs."
    exit 1
  fi
fi
