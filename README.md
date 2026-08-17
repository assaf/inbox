# inbox — clean USPS Informed Delivery, delivered back to your Inbox

A self-hosted service that strips the ads out of USPS "Informed Delivery" digests
in your own Fastmail inbox. USPS replaces your actual mail scans with ads
(`mailer-*.jpg` / `content-*.jpg`); this app listens for each digest via
**Fastmail JMAP push**, rebuilds a one-screen version (packages first, then real
scans, then an honest "these mailpieces had no scan" note), and imports the clean
copy back into your Inbox — archiving the original.

It runs on **your** Vercel account and operates on **your** Fastmail account.
This is a personal tool you host yourself, not a service you sign up for.

## Prerequisites

- **Fastmail** on a Standard (or higher) plan — API tokens are not available on
  the Basic plan.
- A **Vercel** account (the free Hobby tier is enough).
- **Node 20+** and **pnpm**.
- **Cloudflare** (optional) — only if you want the envelope OCR that fills in
  sender names for scans that lack a USPS `FROM:` label.

## How it works

```
USPS digest arrives in Fastmail
        │  JMAP StateChange push (RFC 8291 aes128gcm)
        ▼
Vercel /api/push ──decrypt──► process the digest
        │
        ▼
Email/query (unprocessed digests) → download raw MIME
        │
        ▼
parse + strip ads + rebuild (lib/digest.ts) + OCR senders (lib/sender.ts)
        │
        ▼
Email/import into Inbox → mark original read + $usps-processed
```

- **Push**: Fastmail POSTs an encrypted `StateChange` to `/api/push`. The
  subscription is created/renewed by `ensureSubscription()` (via `pnpm setup`
  and the daily cron). The webhook also completes the `PushVerification`
  handshake.
- **Idempotency**: processed originals get a `$usps-processed` keyword; the
  query filters on it. A failed import leaves the original untouched for the
  next push. Each digest is marked before it is imported, so a re-fired push
  can't re-process it into duplicate copies.

### Why it doesn't hallucinate

- **Ad-stripping is a filename deny-list**, not an LLM call: campaign creative is
  always `mailer-*.jpg` / `content-*.jpg`; every other image is a real scan.
- **Senders come from the `FROM:` labels first**, then vision. USPS renders many
  scans beneath a `FROM:` heading; `mapCidSenders` walks document order and
  attaches the nearest preceding `FROM:` to each `cid:` image. Scans without a
  label are OCR'd with Cloudflare Workers AI
  (`@cf/meta/llama-3.2-11b-vision-instruct`) — reading the sender's return
  address off the envelope. Deterministic (`temperature: 0`), and skipped
  entirely when the Cloudflare env vars are unset (those scans render "Unknown
  sender").
- The digest is parsed from the **text rendering** of the HTML (the visible
  labels "Expected Today", "FROM:", "N item(s)") — the structure is table soup
  that USPS rewrites freely, but the labels have been stable for years.

Ported from [ventz/usps-informed-delivery-no-ads](https://github.com/ventz/usps-informed-delivery-no-ads)
(Python/SES/S3/Lambda → TypeScript/Fastmail JMAP/Vercel).

## Setup

1. **Clone and install**

   ```
   git clone <this repo> && cd inbox
   pnpm install
   ```

2. **Create a Fastmail API token** — Settings → Privacy & Security → Integrations
   → API tokens. This grants full read+write access to your mail, so treat it as
   a password.

3. **Create a Cloudflare Workers AI token** (optional, for envelope OCR) —
   dash.cloudflare.com → API tokens → Workers AI. Note the account id.

4. **Configure env vars** — copy `.env.example` to `.env` and fill in
   `FASTMAIL_TOKEN`, `PUBLIC_URL`, and `DEVICE_CLIENT_ID` (any stable string).
   Add `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` if you want OCR.

5. **Deploy to Vercel** and add the same vars to the project (production):

   ```
   vercel env add FASTMAIL_TOKEN <token> production
   vercel env add PUBLIC_URL https://<your-deployment>.vercel.app production
   vercel env add DEVICE_CLIENT_ID <stable-id> production
   vercel env add CRON_SECRET <random-string> production
   vercel env add CLOUDFLARE_ACCOUNT_ID <id> production
   vercel env add CLOUDFLARE_API_TOKEN <token> production
   vercel deploy --prod
   ```

   (A `./scripts/deploy` helper does check → test → secretlint → knip → deploy →
   smoke-check for you.)

6. **Generate push keys + create the subscription** — run `pnpm setup`. It writes
   `PUSH_PRIVATE_KEY` / `PUSH_AUTH` to `.env` and prints two `vercel env add`
   commands. Run those two commands, redeploy, then run `pnpm setup` again so
   the verification webhook can decrypt and the subscription is created as
   verified.

7. **Verify** — the Vercel function log shows
   `[push] verified subscription <id>`. The next digest (or a test email) should
   produce a clean "Mail for …" copy in your Inbox and archive the original. To
   process an existing backlog once, run `pnpm process`.

The deployment serves a small **status page** at the root URL (`/`) showing JMAP
reachability, push-subscription health, OCR configuration, and recent digests.

## Env vars

| Var                              | Required    | Notes                                                |
| -------------------------------- | ----------- | ---------------------------------------------------- |
| `FASTMAIL_TOKEN`                 | yes         | JMAP API token (Bearer auth)                         |
| `PUBLIC_URL`                     | yes         | base URL; push endpoint is `<PUBLIC_URL>/api/push`   |
| `PUSH_PRIVATE_KEY` / `PUSH_AUTH` | yes         | generated by `pnpm setup`; never commit              |
| `DEVICE_CLIENT_ID`               | yes         | stable id for this device's subscription             |
| `CRON_SECRET`                    | recommended | Vercel sends it as `Authorization: Bearer …` on cron |
| `CLOUDFLARE_ACCOUNT_ID`          | for OCR     | Cloudflare account id                                |
| `CLOUDFLARE_API_TOKEN`           | for OCR     | Workers AI token                                     |
| `CLOUDFLARE_OCR_MODEL`           | no          | defaults `@cf/meta/llama-3.2-11b-vision-instruct`    |
| `DIGEST_FROM`                    | no          | defaults `informeddelivery` (substring match)        |
| `DIGEST_SUBJECT`                 | no          | defaults `Daily Digest`                              |
| `PROCESSED_KEYWORD`              | no          | defaults `$usps-processed`                           |

## Operating

- **Deploy**: `./scripts/deploy` (check + test + secretlint + knip + deploy +
  post-deploy smoke check).
- **Upgrade dependencies**: `./scripts/upgrade` (holds TypeScript on the stable
  5.x line — 7.x is a native preview that breaks the Vercel build).
- **Subscription renewal**: Fastmail push subscriptions expire after ~30 days.
  A daily cron (`0 12 * * *`) calls `/api/cron` to renew an expiring
  subscription automatically. You can also run `pnpm setup` manually.
- **Health check**: `GET /api/smoke` with the `x-smoke-secret` header (gated by
  `SMOKE_TEST_SECRET`) reports JMAP / push / OCR status.

## Development

```
pnpm install
pnpm check        # format + lint + typecheck
pnpm test         # test suite
pnpm secretlint   # no secrets in the repo
pnpm knip         # no unused files/deps
pnpm dry-run      # read-only: parse real digests, write clean .eml to out/
pnpm process [n]  # live: import clean copy + archive original (n = limit)
pnpm dev          # vercel dev via portless, https://inbox.localhost
```

The push flow needs a public URL, so test the parse/render pipeline locally with
`pnpm dry-run` (writes `out/*.eml`, no inbox changes), and test the full push
path against a deployed preview.

Hard-won notes on Fastmail JMAP quirks, the Cloudflare OCR setup, and a past
re-import loop are in [`docs/gotchas.md`](docs/gotchas.md).
