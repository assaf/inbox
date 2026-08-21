# Gotchas & operating notes

Hard-won facts about Fastmail JMAP, Cloudflare OCR, and this project's
architecture. Read before touching the pipeline.

## Fastmail JMAP

- **Keywords are `$`-prefixed, not RFC `\`-prefixed.** Fastmail rejects
  `\seen` and `\archive` (Email/set returns `notUpdated` with
  `invalidProperties`); its read flag is `$seen`. There is no archive keyword —
  archiving is a mailbox move to the `role: "archive"` mailbox. Trash is the
  same: `Email/set` with `mailboxIds: { <trash>: true }` — Fastmail treats
  `mailboxIds` in an update as a full replacement (values must all be `true`;
  a `false` value errors with `invalidProperties`), so naming only the Trash
  mailbox moves the email out of the Inbox.
- **`$usps-processed` is one-way.** It can be set but _not_ removed (both the
  flattened `keywords/$name: false` and map forms are rejected). Consequence:
  `processNewDigests` marks **before** import and has no rollback — a failed
  import leaves the original marked (still visible in Inbox, just skipped).
- **`Email/set`/`Email/import` can "succeed" while individual objects fail.**
  Per-object failures come back in `notUpdated`/`notCreated`/`notDestroyed`,
  not as a method `error`. `api()` now throws on them — this is what hid the
  re-import loop (invalid `\seen` keyword silently failed the whole set).
- **`PushSubscription.verificationCode` is always `null` on GET.** Fastmail
  clears it after verification, so you cannot detect verified-vs-unverified via
  the API. `ensureSubscription` therefore renews on _expiry only_.
- Push subscriptions require encrypted `keys` (Web Push) — Fastmail rejects
  plaintext push URLs.
- Raw email download: use `downloadUrl` (NOT `uploadUrl`) with
  `type=message/rfc822`; `message/rfc822` and `application/octet-stream` both
  return the full RFC 5322 source.
- Session fields needed: `apiUrl`, `uploadUrl`, `downloadUrl`, `username`,
  `primaryAccounts["urn:ietf:params:jmap:mail"]`.

## Cloudflare Workers AI (envelope OCR)

- Model: `@cf/meta/llama-3.2-11b-vision-instruct`.
- Send `{ prompt: "agree", stream: false }` once before first inference to
  accept the Meta license (idempotent — a repeat call errors harmlessly).
- **`stream: false` is required** — the default `stream: true` returns an empty
  `result`.
- The response is nested: `result.result.response` (not `result.response`).
- `temperature: 0` — without it the sender extraction is non-deterministic
  (flipped between "Internal Revenue Service" and "Official Business").
- Image input is an array of byte integers (`Array.from(buffer)`), not base64.
- Moondream's `query` task conflates sender and recipient (returned the
  recipient's own name); use llama vision for sender extraction, not Moondream.

## The re-import loop (2026-08)

Cause: `markProcessed` used `\seen`/`\archive`, which Fastmail rejected, so the
`$usps-processed` keyword never applied, so every import fired a fresh push and
re-processed the same digests forever (~900 duplicate clean copies).

Fixes, in order of importance:

1. `markProcessed` sets `$usps-processed` + `$seen` (Fastmail keywords).
2. Clean copies are imported already carrying `$usps-processed`.
3. **Mark-before-import** + **process one digest per push** (`processNewDigests(1)`
   in the push handler) so a concurrent re-run can't re-process the same digest.
4. **Trash the original after a successful import** (`trashEmail` in
   `processNewDigests`). Trashing comes last on purpose: if rebuild/import
   fails, the original stays untouched in the Inbox, and it stays put if the
   trash move itself fails (nothing lost — just a straggler in the Inbox).

## Ops

- **Vercel project:** `inbox` is the correct one (Framework Preset "Other",
  domain inbox.labnotes.org). `inbox-3psp` is a stray duplicate with a
  "React Router" preset — delete it.
- **Hobby plan:** cron jobs max once per day. A daily cron (`0 12 * * *`)
  calls `/api/cron` to renew the push subscription and drain any backlog the
  push missed (the catch-up net); processing is otherwise push-driven.
- `vercel deploy --prod` has intermittently hung locally; the dashboard or
  `git push` (GitHub auto-deploy) are reliable alternatives.
- Fastmail OAuth 2.0 exists (auth code + PKCE) but requires manual client
  registration with Fastmail — not self-serve. API token is correct for
  self-use.

## Security

- **Push auth = ECE decryption.** Decrypting an RFC 8291 `aes128gcm` payload
  is the only authentication on `/api/push`; anyone holding the `p256dh`
  public key can forge payloads. The public key is derivable from
  `PUSH_PRIVATE_KEY` and is stored in the Fastmail subscription — keep both
  env vars private. Forged payloads are low-impact anyway: StateChange just
  re-triggers idempotent processing, and PushVerification codes are validated
  by Fastmail.
- **Digest sender verification.** The JMAP query filter (`DIGEST_FROM`) is a
  loose substring match and SMTP `From:` is spoofable, so every candidate is
  checked against the exact `DIGEST_SENDER` address (case-insensitive) before
  download/OCR/import, and skipped otherwise (log: `skipping digest from
unexpected sender`). Partial defense: a spoof using the exact address in
  the From header still passes; real defense would be DKIM verification
  (overkill here).
- **Secret-gated endpoints.** `/api/cron` requires `CRON_SECRET` (Vercel cron
  requests carry no built-in auth) and `/api/smoke` requires
  `SMOKE_TEST_SECRET`; both compare via `safeEqual` (timing-safe).
- **Accepted residual risk.** The root status page (`/api/index`) is
  unauthenticated and reveals mail volume, subscription id/expiry, and recent
  activity, and each load fires JMAP calls; no rate limiting on `/api/push`
  (1 MiB body cap, cheap ECDH — fine on Hobby); `http_ece` is unmaintained
  (no known CVEs; pin it); digest attachments are embedded uncapped (a
  spoofed digest could produce an oversized rebuilt email).
- **Secrets hygiene.** secretlint skips gitignored files, so it will NOT catch
  a committed `.env*`. Delete `.env.prod.pull` / `VERCEL_OIDC_TOKEN` dumps
  after pulling, and check `git status` for stray `.env*` before committing.
