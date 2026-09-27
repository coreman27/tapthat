#!/usr/bin/env bash
# Background poller for donttapthat.com custom-domain setup.
# Waits (up to ~2h) for the ACM cert to be ISSUED after you add the validation
# CNAMEs at Namecheap, then attaches donttapthat.com + www to CloudFront.
#
#   Run in the background:  nohup ./scripts/.finish-poll.sh > /tmp/donttapthat-domain.log 2>&1 &
set -uo pipefail
REGION="us-east-1"
CERT_ARN="arn:aws:acm:us-east-1:981207388221:certificate/5e6f8b80-ac82-4fb4-8138-65545179e65c"
DIST_ID="E2XJJ61LKTCHVW"
# Poll cert status up to ~2 hours (120 * 60s)
for i in $(seq 1 120); do
  ST=$(aws acm describe-certificate --region "$REGION" --certificate-arn "$CERT_ARN" --query "Certificate.Status" --output text 2>/dev/null)
  echo "[$(date +%H:%M:%S)] attempt $i: cert status = $ST"
  if [ "$ST" = "ISSUED" ]; then break; fi
  sleep 60
done
if [ "$ST" != "ISSUED" ]; then echo "TIMED OUT waiting for cert"; exit 2; fi

echo "Cert issued. Attaching custom domains to CloudFront..."
tmp="$(mktemp -d)"
aws cloudfront get-distribution-config --id "$DIST_ID" > "$tmp/get.json"
ETAG="$(python3 -c "import json;print(json.load(open('$tmp/get.json'))['ETag'])")"
python3 - "$tmp/get.json" "$tmp/update.json" "$CERT_ARN" <<'PY'
import json, sys
src, dst, cert = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = json.load(open(src))["DistributionConfig"]
cfg["Aliases"] = {"Quantity": 2, "Items": ["donttapthat.com", "www.donttapthat.com"]}
cfg["ViewerCertificate"] = {"ACMCertificateArn": cert, "SSLSupportMethod": "sni-only",
                            "MinimumProtocolVersion": "TLSv1.2_2021", "CloudFrontDefaultCertificate": False}
json.dump(cfg, open(dst, "w"))
PY
aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" \
  --distribution-config "file://$tmp/update.json" \
  --query "Distribution.{Status:Status,Aliases:DistributionConfig.Aliases.Items}" --output json
rm -rf "$tmp"
echo "ATTACHED. donttapthat.com + www.donttapthat.com configured on CloudFront."
