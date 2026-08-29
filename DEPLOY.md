# Deploying DON'T TAP THAT to AWS

The web game is hosted as a static site on **Amazon S3** (private bucket) behind **Amazon CloudFront** (HTTPS + global CDN). HTTPS is required for the service worker (offline/PWA) and the native share sheet.

## Live URL

**https://d10kns7njmuyxo.cloudfront.net**

## Current deployment (account 981207388221, us-east-1)

| Resource | Value |
|---|---|
| S3 bucket | `tapthat-game-1788042934` (private) |
| CloudFront distribution | `E2XJJ61LKTCHVW` |
| CloudFront domain | `d10kns7njmuyxo.cloudfront.net` |
| Origin Access Control | S3 OAC (bucket readable only via this distribution) |
| Viewer policy | redirect-to-HTTPS, compression on |

The S3 bucket is **not public** — CloudFront reads it via Origin Access Control, and a bucket policy restricts `s3:GetObject` to this specific distribution ARN.

## Redeploy after code changes

One command (rebuilds `www/`, uploads with correct content-types, and invalidates the CDN cache):

```bash
cd tapthat
BUCKET=tapthat-game-1788042934 DIST_ID=E2XJJ61LKTCHVW npm run deploy
```

`sw.js` and `index.html` are uploaded with `Cache-Control: no-cache` and every deploy issues a CloudFront invalidation, so updates go live within seconds — no stale-cache problems.

## First-time setup (already done, for reference)

1. `aws s3api create-bucket --bucket <name> --region us-east-1`
2. Block public ACLs (`put-public-access-block`), keep bucket private.
3. Upload `www/` with correct content-types.
4. `aws cloudfront create-origin-access-control …`
5. `aws cloudfront create-distribution …` with `DefaultRootObject=index.html`, OAC origin, `redirect-to-https`, and a 403→`/index.html` custom error response.
6. `aws s3api put-bucket-policy …` allowing `cloudfront.amazonaws.com` for this distribution ARN only.

## Optional next steps

- **Custom domain:** register/point a domain (Route 53 or elsewhere), request an ACM cert **in us-east-1**, add it + the domain as a CloudFront Alternate Domain Name (CNAME).
- **CI/CD:** run `npm run deploy` from a GitHub Action on push to `main` (store AWS creds as repo secrets, ideally a scoped IAM user — not root).
