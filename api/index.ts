import type { VercelRequest, VercelResponse } from "@vercel/node";
import { envOpt } from "../lib/config.js";
import { esc } from "../lib/html.js";
import { recentProcessed, unprocessedDigestIds } from "../lib/jmap.js";
import { collectStatus } from "../lib/status.js";

interface Row {
  name: string;
  ok: boolean;
  detail: string;
}

async function statusRows(): Promise<{ rows: Row[]; pending: string; recent: string[] }> {
  const status = await collectStatus();
  const rows: Row[] = [
    { name: "JMAP", ok: status.jmapOk, detail: status.jmapDetail },
    { name: "Push subscription", ok: status.pushOk, detail: status.pushDetail },
    {
      name: "Envelope OCR",
      ok: status.ocrOk,
      detail: status.ocrOk ? "Cloudflare configured" : "CLOUDFLARE_* vars missing",
    },
  ];

  let pending = "?";
  try {
    pending = String((await unprocessedDigestIds()).length);
  } catch {
    // unknown
  }

  const recent: string[] = [];
  try {
    for (const e of await recentProcessed(5)) {
      recent.push(`${e.receivedAt ? e.receivedAt.slice(0, 10) : "?"} — ${e.subject}`);
    }
  } catch {
    // recent history is best-effort
  }

  return { rows, pending, recent };
}

function embedCard(base: string): string {
  const url = `${base}/github.heatmap.png`;
  const html = `<img src="${url}" width="918" height="187" alt="GitHub contributions in the last year">`;
  const markdown = `![GitHub contributions in the last year](${url})`;
  const linked = `<a href="https://github.com/assaf"><img src="${url}" width="918" height="187" alt="GitHub contributions in the last year"></a>`;

  return `
  <div class="card">
    <h2 style="font-size:14px;margin:0 0 4px;">Embed the heatmap</h2>
    <p class="note">The last year of GitHub contributions, rendered server-side. The PNG is
      <strong>1836×374</strong>, a 2x asset: embed it at <strong>918×187</strong> so it stays
      sharp on retina displays. No JavaScript, no API key — hotlink it from any page. It is
      regenerated on demand and cached for 4 hours.</p>
    <img class="preview" src="/github.heatmap.png" width="918" height="187" alt="GitHub contributions in the last year">
    <p class="note">Image URL: <a href="${esc(url)}">${esc(url)}</a></p>
    <p class="label">HTML</p>
    <pre><code>${esc(html)}</code></pre>
    <p class="label">Markdown</p>
    <pre><code>${esc(markdown)}</code></pre>
    <p class="label">Linked image</p>
    <pre><code>${esc(linked)}</code></pre>
    <p class="note">Scale it with CSS (<code>width:100%;height:auto</code>) if the column is
      narrower than 918px; keep the <code>width</code>/<code>height</code> attributes so the
      layout does not jump while the PNG loads. The image is a fixed size — the week count is
      normalised to 53 columns — so the attributes never fight the asset.</p>
  </div>`;
}

function page(rows: Row[], pending: string, recent: string[], base: string): string {
  const allOk = rows.every((r) => r.ok);
  const dot = allOk ? "#16a34a" : "#dc2626";
  const headline = allOk ? "healthy" : "attention needed";

  const symbol = (ok: boolean): string =>
    `<span role="img" aria-label="${ok ? "ok" : "problem"}">${ok ? "✓" : "✗"}</span>`;

  const rowHtml = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:8px 12px;color:${r.ok ? "#16a34a" : "#dc2626"};font-weight:700;">${symbol(r.ok)}</td>
        <td style="padding:8px 12px;font-weight:600;">${esc(r.name)}</td>
        <td style="padding:8px 12px;color:var(--muted);">${esc(r.detail)}</td>
      </tr>`,
    )
    .join("");

  const recentHtml = recent.length
    ? recent.map((r) => `<li style="margin:4px 0;color:var(--muted);">${esc(r)}</li>`).join("")
    : `<li style="margin:4px 0;color:var(--muted);">none yet</li>`;

  const th =
    "padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);border-bottom:1px solid var(--border);font-weight:600;";

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
  .note { color:var(--muted); font-size:13px; margin:8px 0 0; }
  .label { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:600; margin:16px 0 4px; }
  .preview { display:block; width:100%; height:auto; margin:12px 0 0; border-radius:6px; }
  pre { margin:0; padding:10px 12px; white-space:pre-wrap; word-break:break-word; background:var(--bg); border:1px solid var(--border); border-radius:8px; }
  code { font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  .note code { word-break:normal; }
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
    <table aria-label="Service status">
      <thead><tr>
        <th scope="col" style="${th}">Status</th>
        <th scope="col" style="${th}">Check</th>
        <th scope="col" style="${th}">Detail</th>
      </tr></thead>
      <tbody>${rowHtml}</tbody>
    </table>
  </div>

  <div class="card pending">
    Unprocessed digests: <strong>${esc(pending)}</strong>
    <h2 style="font-size:14px;margin:16px 0 4px;">Recently cleaned</h2>
    <ul>${recentHtml}</ul>
  </div>

  ${embedCard(base)}
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
  const forwarded = req.headers?.["x-forwarded-host"];
  const host = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.headers?.host;
  const base = (envOpt("PUBLIC_URL") ?? `https://${host ?? "localhost"}`).replace(/\/+$/, "");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(page(rows, pending, recent, base));
}
