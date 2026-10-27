#!/usr/bin/env bash
# Retire the web version of DON'T TAP THAT (donttapthat.com, www, and the CloudFront site behind them).
#
#   AWS_PROFILE=corey ./scripts/retire-web.sh --dry-run    # show the plan, change nothing
#   AWS_PROFILE=corey ./scripts/retire-web.sh              # do it
#
# What it does, in this order (it stops at the first failure):
#   1. Checks the new company pages are live. If they are not, it refuses: redirecting to a 404 would
#      break the privacy link of the live app listing.
#   2. Uploads a kill-switch service worker as /sw.js, so anyone who installed the old web game has
#      their cached copy cleared and unregistered.
#   3. Creates/updates a CloudFront Function that 301-redirects every other URL to the company pages,
#      then attaches it to the distribution's default behavior.
#   4. Waits for CloudFront to deploy, invalidates the cache, and VERIFIES the redirects over HTTPS.
#   5. Only after verification, deletes the old game files from the bucket (everything except sw.js).
#      The game source stays in git, so this is reversible by redeploying an old commit.
set -euo pipefail

BUCKET="tapthat-game-1788042934"
DIST_ID="E2XJJ61LKTCHVW"
FN_NAME="dtt-web-retired"
NEW_BASE="https://hallsoftwaresolutions.com/dont-tap-that"
export AWS_PROFILE="${AWS_PROFILE:-corey}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
cd "$(dirname "$0")/web-retirement"

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
say() { echo "→ $*"; }
run() { if [ "$DRY" = 1 ]; then echo "   (dry run) $*"; else "$@"; fi; }

say "Step 1: the new company pages must be live"
for path in "/" "/privacy/" "/support/"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$NEW_BASE$path")"
  if [ "$code" != "200" ]; then
    echo "ERROR: $NEW_BASE$path returned $code. Deploy the company site first (hallsoftwaresolutions-site: ./redeploy.sh)."
    exit 1
  fi
  echo "   ok  $NEW_BASE$path"
done

say "Step 2: kill-switch service worker -> s3://$BUCKET/sw.js"
run aws s3 cp sw-kill-switch.js "s3://$BUCKET/sw.js" --content-type "text/javascript; charset=utf-8" --cache-control "no-cache"

say "Step 3: CloudFront Function $FN_NAME"
if [ "$DRY" = 1 ]; then
  echo "   (dry run) create or update $FN_NAME, publish it, attach to $DIST_ID as a viewer-request function"
else
  if aws cloudfront describe-function --name "$FN_NAME" >/dev/null 2>&1; then
    ETAG="$(aws cloudfront describe-function --name "$FN_NAME" --query ETag --output text)"
    aws cloudfront update-function --name "$FN_NAME" --if-match "$ETAG" \
      --function-config "Comment=Retired web version: redirect to the company pages,Runtime=cloudfront-js-2.0" \
      --function-code fileb://redirect.cf.js >/dev/null
  else
    aws cloudfront create-function --name "$FN_NAME" \
      --function-config "Comment=Retired web version: redirect to the company pages,Runtime=cloudfront-js-2.0" \
      --function-code fileb://redirect.cf.js >/dev/null
  fi
  ETAG="$(aws cloudfront describe-function --name "$FN_NAME" --query ETag --output text)"
  FN_ARN="$(aws cloudfront publish-function --name "$FN_NAME" --if-match "$ETAG" \
    --query FunctionSummary.FunctionMetadata.FunctionARN --output text)"
  echo "   published $FN_ARN"

  tmp="$(mktemp -d)"
  aws cloudfront get-distribution-config --id "$DIST_ID" > "$tmp/get.json"
  ETAG="$(python3 -c "import json;print(json.load(open('$tmp/get.json'))['ETag'])")"
  python3 - "$tmp" "$FN_ARN" <<'PY'
import json, sys
tmp, arn = sys.argv[1], sys.argv[2]
cfg = json.load(open(tmp + '/get.json'))['DistributionConfig']
cfg['DefaultCacheBehavior']['FunctionAssociations'] = {
    'Quantity': 1, 'Items': [{'FunctionARN': arn, 'EventType': 'viewer-request'}]}
json.dump(cfg, open(tmp + '/put.json', 'w'))
PY
  aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" \
    --distribution-config "file://$tmp/put.json" >/dev/null
  echo "   attached to $DIST_ID"
fi

say "Step 4: wait for CloudFront, clear its cache, then verify the redirects"
run aws cloudfront wait distribution-deployed --id "$DIST_ID"
run aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" --query "Invalidation.Id" --output text

check_redirect() {
  local url="$1" want="$2" got
  got="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$url")"
  if [ "$got" != "301 $want" ]; then echo "ERROR: $url -> '$got' (wanted '301 $want')"; return 1; fi
  echo "   ok  $url -> $want"
}
if [ "$DRY" = 1 ]; then
  echo "   (dry run) would check: / and /privacy.html and /support redirect (301) on donttapthat.com and www, and /sw.js is the kill-switch"
else
  for host in donttapthat.com www.donttapthat.com; do
    check_redirect "https://$host/" "$NEW_BASE/"
    check_redirect "https://$host/privacy.html" "$NEW_BASE/privacy/"
    check_redirect "https://$host/support" "$NEW_BASE/support/"
    check_redirect "https://$host/anything/else?x=1" "$NEW_BASE/"
  done
  if ! curl -s "https://donttapthat.com/sw.js" | grep -q "registration.unregister"; then
    echo "ERROR: /sw.js is not the kill-switch"; exit 1
  fi
  echo "   ok  /sw.js is the kill-switch"
fi

say "Step 5: delete the old game files (everything except sw.js)"
run aws s3 rm "s3://$BUCKET/" --recursive --exclude "sw.js"

echo
if [ "$DRY" = 1 ]; then
  echo "Dry run complete. Nothing was changed. Run again without --dry-run to retire the web version."
else
  echo "Done. The web version is retired. donttapthat.com now forwards to $NEW_BASE/"
fi
