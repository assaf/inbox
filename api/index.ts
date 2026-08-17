import type { VercelRequest, VercelResponse } from "@vercel/node";
import { envDefault, envOpt } from "../lib/config.js";
import {
  api,
  listMailboxes,
  listSubscriptions,
  session,
  unprocessedDigestIds,
} from "../lib/jmap.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Row {
  name: string;
  ok: boolean;
  detail: string;
}

async function statusRows(): Promise<{ rows: Row[]; pending: string; recent: string[] }> {
  const rows: Row[] = [];

  try {
    const boxes = await listMailboxes();
    rows.push({ name: "JMAP", ok: true, detail: `${boxes.length} mailboxes` });
  } catch (err) {
    rows.push({ name: "JMAP", ok: false, detail: String(err) });
  }

  try {
    const deviceId = envDefault("DEVICE_CLIENT_ID", "usps-digest-cleaner");
    const subs = (await listSubscriptions()).filter((s) => s.deviceClientId === deviceId);
    if (subs.length === 0) {
      rows.push({ name: "Push subscription", ok: false, detail: "none — run `pnpm setup`" });
    } else {
      const s = subs[0]!;
      const exp = s.expires ? new Date(s.expires).toLocaleString() : "no expiry";
      rows.push({ name: "Push subscription", ok: true, detail: `id ${s.id} · expires ${exp}` });
    }
  } catch (err) {
    rows.push({ name: "Push subscription", ok: false, detail: String(err) });
  }

  const ocr = Boolean(envOpt("CLOUDFLARE_ACCOUNT_ID") && envOpt("CLOUDFLARE_API_TOKEN"));
  rows.push({
    name: "Envelope OCR",
    ok: ocr,
    detail: ocr ? "Cloudflare configured" : "CLOUDFLARE_* vars missing",
  });

  let pending = "?";
  try {
    pending = String((await unprocessedDigestIds()).length);
  } catch {
    // unknown
  }

  const recent: string[] = [];
  try {
    const s = await session();
    const kw = envDefault("PROCESSED_KEYWORD", "$usps-processed");
    const q = await api([
      [
        "Email/query",
        {
          accountId: s.accountId,
          filter: { hasKeyword: kw },
          sort: [{ property: "receivedAt", isAscending: false }],
          limit: 5,
        },
        "q0",
      ],
    ]);
    const ids = (q[0]?.[1] as { ids: string[] } | undefined)?.ids ?? [];
    if (ids.length) {
      const g = await api([
        ["Email/get", { accountId: s.accountId, ids, properties: ["subject", "receivedAt"] }, "g0"],
      ]);
      const list =
        (g[0]?.[1] as { list: Array<{ subject?: string; receivedAt?: string }> } | undefined)
          ?.list ?? [];
      for (const e of list) {
        recent.push(`${e.receivedAt?.slice(0, 10) ?? "?"} — ${e.subject ?? ""}`);
      }
    }
  } catch {
    // recent history is best-effort
  }

  return { rows, pending, recent };
}

function page(rows: Row[], pending: string, recent: string[]): string {
  const allOk = rows.every((r) => r.ok);
  const dot = allOk ? "#16a34a" : "#dc2626";
  const headline = allOk ? "healthy" : "attention needed";

  const rowHtml = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:8px 12px;color:${r.ok ? "#16a34a" : "#dc2626"};font-weight:700;">${r.ok ? "✓" : "✗"}</td>
        <td style="padding:8px 12px;font-weight:600;">${esc(r.name)}</td>
        <td style="padding:8px 12px;color:var(--muted);">${esc(r.detail)}</td>
      </tr>`,
    )
    .join("");

  const recentHtml = recent.length
    ? recent.map((r) => `<li style="margin:4px 0;color:var(--muted);">${esc(r)}</li>`).join("")
    : `<li style="margin:4px 0;color:var(--muted);">none yet</li>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>inbox — USPS digest cleaner</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/android-chrome-512x512.png">
<meta name="theme-color" content="#111827">
<style>
  :root { --bg:#f4f5f7; --card:#fff; --ink:#1c1e21; --muted:#6b7280; --border:#e5e7eb; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#111827; --card:#1f2937; --ink:#f9fafb; --muted:#9ca3af; --border:#374151; }
  }
  * { box-sizing:border-box; }
  body { margin:0; padding:24px; font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; background:var(--bg); color:var(--ink); }
  .wrap { max-width:640px; margin:0 auto; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:20px 24px; margin-bottom:16px; }
  h1 { font-size:20px; margin:0; }
  .brand { display:flex; align-items:center; gap:10px; margin:0 0 4px; }
  .brand img { width:28px; height:28px; flex-shrink:0; }
  .sub { color:var(--muted); margin:0 0 16px; }
  table { border-collapse:collapse; width:100%; }
  td { border-bottom:1px solid var(--border); }
  tr:last-child td { border-bottom:none; }
  .pending { font-size:15px; }
  .pending strong { font-size:22px; }
  ul { padding-left:20px; margin:8px 0 0; }
  .foot { color:var(--muted); font-size:13px; }
  a { color:inherit; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <img src="/favicon.svg" alt="" width="28" height="28">
    <h1>inbox — USPS digest cleaner</h1>
  </div>
  <p class="sub">Cleans Informed Delivery digests via Fastmail JMAP push.</p>

  <div class="card">
    <table>${rowHtml}</table>
  </div>

  <div class="card pending">
    Unprocessed digests: <strong>${esc(pending)}</strong>
    <h2 style="font-size:14px;margin:16px 0 4px;">Recently cleaned</h2>
    <ul>${recentHtml}</ul>
  </div>

  <p class="foot">
    Status is <span style="color:${dot};font-weight:700;">● ${headline}</span>.
    Checks refresh on each load · <a href="https://vercel.com/dashboard">Vercel</a> ·
    <a href="https://app.fastmail.com/settings/security/tokens">Fastmail tokens</a>
  </p>
</div>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).end();
    return;
  }
  const { rows, pending, recent } = await statusRows();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(page(rows, pending, recent));
}
