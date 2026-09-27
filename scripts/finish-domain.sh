#!/usr/bin/env bash
# Completes the custom-domain setup for donttapthat.com (+ www).
#
# Prerequisite (do this at your Namecheap "Advanced DNS" panel for donttapthat.com):
#
#   1. ACM validation CNAMEs (issue the TLS cert). At Namecheap, enter the Host
#      WITHOUT the trailing ".donttapthat.com" (Namecheap appends the domain):
#
#        Type   Host                                          Value
#        CNAME  _d010c222562a6b5f439732d8694cccab             _a8b8fdd7a131df3a8dedf52e5f733cd3.wzccmgtwzk.acm-validations.aws.
#        CNAME  _b3ac0890666b104db9f549311f9277d3.www         _479876990ef92b924ccd93efdfe972a8.wzccmgtwzk.acm-validations.aws.
#
#   2. Point the domain at CloudFront (d10kns7njmuyxo.cloudfront.net):
#
#        Type            Host   Value
#        ALIAS (or CNAME) @     d10kns7njmuyxo.cloudfront.net.
#        CNAME            www   d10kns7njmuyxo.cloudfront.net.
#
#      (Remove the default Namecheap parking/redirect records for @ and www first.)
#
# Then run this script. It waits for the cert to be ISSUED, then attaches the
# custom domains + cert to the CloudFront distribution.
set -euo pipefail

REGION="us-east-1"
CERT_ARN="arn:aws:acm:us-east-1:981207388221:certificate/5e6f8b80-ac82-4fb4-8138-65545179e65c"
DIST_ID="E2XJJ61LKTCHVW"

echo "Waiting for ACM certificate to be issued (add the validation CNAMEs at Namecheap if you haven't)..."
aws acm wait certificate-validated --region "$REGION" --certificate-arn "$CERT_ARN"
echo "Certificate issued."

tmp="$(mktemp -d)"
aws cloudfront get-distribution-config --id "$DIST_ID" > "$tmp/get.json"
ETAG="$(python3 -c "import json,sys;print(json.load(open('$tmp/get.json'))['ETag'])")"

python3 - "$tmp/get.json" "$tmp/update.json" "$CERT_ARN" <<'PY'
import json, sys
src, dst, cert = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = json.load(open(src))["DistributionConfig"]
cfg["Aliases"] = {"Quantity": 2,
                  "Items": ["donttapthat.com", "www.donttapthat.com"]}
cfg["ViewerCertificate"] = {
    "ACMCertificateArn": cert,
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021",
    "CloudFrontDefaultCertificate": False,
}
json.dump(cfg, open(dst, "w"))
PY

aws cloudfront update-distribution \
  --id "$DIST_ID" \
  --if-match "$ETAG" \
  --distribution-config "file://$tmp/update.json" \
  --query "Distribution.{Id:Id,Status:Status,Aliases:DistributionConfig.Aliases.Items}" --output json

rm -rf "$tmp"
echo "Done. Once CloudFront finishes deploying and DNS propagates,"
echo "https://donttapthat.com and https://www.donttapthat.com will serve the game."
