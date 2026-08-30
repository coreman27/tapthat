#!/usr/bin/env bash
# deploy-aws.sh — build www/ and deploy to S3 + CloudFront, then invalidate the CDN cache.
# Usage:
#   BUCKET=<bucket> DIST_ID=<cloudfront-id> ./scripts/deploy-aws.sh
# The bucket + distribution are created once (see APPSTORE.md / AWS section of README).
set -euo pipefail

: "${BUCKET:?Set BUCKET to your S3 bucket name}"
: "${DIST_ID:?Set DIST_ID to your CloudFront distribution id}"
REGION="${REGION:-us-east-1}"

cd "$(dirname "$0")/.."
echo "→ Building www/"
node scripts/sync-www.js >/dev/null
cd www

echo "→ Uploading to s3://$BUCKET"
# Static assets (images, css) — long cache, content-type auto-detected
aws s3 sync . "s3://$BUCKET" --delete \
  --exclude "*.js" --exclude "*.webmanifest" --exclude "index.html" --exclude "privacy.html" --exclude "sw.js" --exclude "*.svg" \
  --cache-control "public,max-age=86400"
# JS — correct type, long cache
aws s3 cp js "s3://$BUCKET/js" --recursive \
  --content-type "text/javascript; charset=utf-8" --cache-control "public,max-age=86400"
# SVG
aws s3 cp icons/icon.svg "s3://$BUCKET/icons/icon.svg" --content-type "image/svg+xml"
# Web manifest
aws s3 cp manifest.webmanifest "s3://$BUCKET/manifest.webmanifest" --content-type "application/manifest+json"
# sw.js + index.html — correct type, NO cache so updates land immediately
aws s3 cp sw.js "s3://$BUCKET/sw.js" --content-type "text/javascript; charset=utf-8" --cache-control "no-cache"
aws s3 cp index.html "s3://$BUCKET/index.html" --content-type "text/html; charset=utf-8" --cache-control "no-cache"
aws s3 cp privacy.html "s3://$BUCKET/privacy.html" --content-type "text/html; charset=utf-8" --cache-control "no-cache"

echo "→ Invalidating CloudFront $DIST_ID"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" \
  --query 'Invalidation.Id' --output text

DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query 'Distribution.DomainName' --output text)
echo "✅ Deployed → https://$DOMAIN"
