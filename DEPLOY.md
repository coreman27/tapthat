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

## Custom domain — donttapthat.com

The domain `donttapthat.com` is registered at **Namecheap** (nameservers
`dns1.registrar-servers.com` / `dns2.registrar-servers.com`), so DNS records are
managed in Namecheap's **Advanced DNS** panel, not Route 53.

An ACM certificate (us-east-1, required by CloudFront) covering
`donttapthat.com` + `www.donttapthat.com` has been requested:

| | Value |
|---|---|
| Certificate ARN | `arn:aws:acm:us-east-1:981207388221:certificate/5e6f8b80-ac82-4fb4-8138-65545179e65c` |
| CloudFront distribution | `E2XJJ61LKTCHVW` (`d10kns7njmuyxo.cloudfront.net`) |

### Step 1 — add DNS records at Namecheap (Advanced DNS)

Enter Host values **without** the trailing `.donttapthat.com` (Namecheap appends the domain automatically):

| Type | Host | Value | Purpose |
|---|---|---|---|
| CNAME | `_d010c222562a6b5f439732d8694cccab` | `_a8b8fdd7a131df3a8dedf52e5f733cd3.wzccmgtwzk.acm-validations.aws.` | ACM validation (apex) |
| CNAME | `_b3ac0890666b104db9f549311f9277d3.www` | `_479876990ef92b924ccd93efdfe972a8.wzccmgtwzk.acm-validations.aws.` | ACM validation (www) |
| ALIAS (or CNAME) | `@` | `d10kns7njmuyxo.cloudfront.net.` | Point apex at CloudFront |
| CNAME | `www` | `d10kns7njmuyxo.cloudfront.net.` | Point www at CloudFront |

Remove the default Namecheap parking / URL-redirect records for `@` and `www` first.

### Step 2 — finish the setup

Once the records are saved, run:

```bash
cd tapthat
./scripts/finish-domain.sh
```

It waits for ACM to issue the cert, then attaches both domains + the cert to the
CloudFront distribution. After CloudFront redeploys (~5–15 min) and DNS
propagates, `https://donttapthat.com` and `https://www.donttapthat.com` serve the game.

## Optional next steps

- **CI/CD:** run `npm run deploy` from a GitHub Action on push to `main` (store AWS creds as repo secrets, ideally a scoped IAM user — not root).
