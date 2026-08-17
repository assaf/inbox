import PostalMime, { type Attachment } from "postal-mime";
import { parseHTML } from "linkedom";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { esc } from "./html.js";

// ---------------------------------------------------------------------------
// Parsing an Informed Delivery digest into a structured Digest.
//
// Ported from ventz/usps-informed-delivery-no-ads (chalicelib/parse.py).
// The visible text labels ("Expected Today", "FROM:", "N item(s)") are the
// stable contract — not the HTML structure, which USPS rewrites freely.
// Ad-stripping is a filename deny-list, never an LLM judgment: campaign
// creative is always `mailer-*.jpg` / `content-*.jpg`; everything else that is
// an image is a real envelope scan.
// ---------------------------------------------------------------------------

const AD_PREFIXES = ["mailer-", "content-"];

const MAIL_SECTIONS = ["Expected Today", "Expected Tomorrow", "Expected This Week"];
const PACKAGE_SECTIONS = [
  "Expected Today",
  "Expected Tomorrow",
  "Expected 1-2 Days",
  "Awaiting From Sender",
  "Outbound",
  "Delivered",
];
const FOOTER_MARKERS = [
  "Refer via Email",
  "You may have more mail or packages",
  "*These images represent mail pieces",
];
const EMPTY_MARKERS = ["No packages are available to display.", "No mail is available to display."];

const COUNTS_RE = /You have\s+(\d+)\s+mailpiece\(s\)\s+and\s+(\d+)\s+inbound package\(s\)/i;
const DATE_RE = /(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/;
const SUBJECT_DATE_RE = /Daily Digest for\s+\w{3},\s*(\d{1,2})\/(\d{1,2})/;
const TRACKING_RE = /\b(\d{20,26})\b/;
const ETA_RE = /Estimated Delivery on:\s*(.+?)\s*$/i;

const KNOWN_LABELS = [...new Set([...MAIL_SECTIONS, ...PACKAGE_SECTIONS])];

export interface Scan {
  filename: string;
  contentType: string;
  data: Buffer;
  cid: string;
  listedSender: string | null;
}

export interface PackageInfo {
  sender: string | null;
  tracking: string | null;
  status: string | null;
  eta: string | null;
}

export interface Digest {
  subject: string;
  from: string | null;
  sentAt: Date | null;
  digestDate: Date | null;
  dateText: string;
  announcedMail: number;
  announcedPackages: number;
  scans: Scan[];
  campaignSenders: string[];
  packages: PackageInfo[];
  droppedAds: string[];

  hiddenMailCount: number;
  sendersWithoutScans: string[];
}

export function isAdAttachment(filename: string): boolean {
  const base = filename.split("/").at(-1)?.toLowerCase() ?? "";
  return AD_PREFIXES.some((p) => base.startsWith(p));
}

function clean(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .trim();
}

// --- text rendering --------------------------------------------------------

/** Parse HTML and strip script/style elements (shared by text walkers). */
function parseHtml(html: string): ReturnType<typeof parseHTML>["document"] {
  const { document } = parseHTML(html);
  for (const el of document.querySelectorAll("script,style")) el.remove();
  return document;
}

function textNodes(html: string): string[] {
  const document = parseHtml(html);
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    const n = node as { nodeType?: number; textContent?: string; childNodes?: unknown[] };
    if (n.nodeType === 3) {
      const t = n.textContent ?? "";
      if (t) parts.push(t);
      return;
    }
    for (const child of n.childNodes ?? []) walk(child);
  };
  // Walk the Document, not documentElement: linkedom sets documentElement to
  // only the FIRST top-level node when the input is a fragment.
  walk(document);
  return parts;
}

export function rejoinFragments(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    let matched = false;
    for (const k of [4, 3, 2]) {
      if (i + k <= n && KNOWN_LABELS.includes(lines.slice(i, i + k).join(" "))) {
        out.push(lines.slice(i, i + k).join(" "));
        i += k;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const cur = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    if (/^\d+$/.test(cur) && next.startsWith("item(s)")) {
      out.push(`${cur} ${next}`);
      i += 2;
    } else {
      out.push(cur);
      i += 1;
    }
  }
  return out;
}

function htmlToLines(html: string): string[] {
  const raw = textNodes(html);
  return rejoinFragments(raw.map(clean).filter((l) => l.length > 0));
}

function truncateAtFooter(lines: string[]): string[] {
  for (let i = 0; i < lines.length; i++) {
    if (FOOTER_MARKERS.some((m) => (lines[i] ?? "").startsWith(m))) {
      return lines.slice(0, i);
    }
  }
  return lines;
}

// --- positional FROM: -> cid mapping ---------------------------------------

export function mapCidSenders(html: string): Map<string, string> {
  const document = parseHtml(html);

  const mapping = new Map<string, string>();
  let lastFrom: string | null = null;
  let awaitingName = false;

  const walk = (node: unknown): void => {
    const n = node as {
      nodeType?: number;
      textContent?: string;
      tagName?: string;
      getAttribute?: (a: string) => string | null;
      childNodes?: unknown[];
    };
    if (n.nodeType === 3) {
      const text = clean(n.textContent ?? "");
      if (!text) return;
      if (text.startsWith("FROM:")) {
        const rest = text.slice("FROM:".length).trim();
        if (rest) {
          lastFrom = rest;
          awaitingName = false;
        } else {
          awaitingName = true;
        }
      } else if (awaitingName) {
        lastFrom = text;
        awaitingName = false;
      }
      return;
    }
    if (n.nodeType === 1 && (n.tagName ?? "").toLowerCase() === "img") {
      const src = (n.getAttribute?.("src") ?? "").trim();
      if (src.toLowerCase().startsWith("cid:") && lastFrom) {
        mapping.set(src.slice(4).trim().replace(/^<|>$/g, ""), lastFrom);
      }
      return;
    }
    for (const child of n.childNodes ?? []) walk(child);
  };
  // Walk the Document, not documentElement (see textNodes).
  walk(document);
  return mapping;
}

// --- region parsing --------------------------------------------------------

function region(lines: string[], startLabel: string, stopLabel: string | null): string[] {
  const start = lines.indexOf(startLabel);
  if (start === -1) return [];
  let end = lines.length;
  if (stopLabel) {
    const stop = lines.indexOf(stopLabel, start + 1);
    if (stop !== -1) end = stop;
  }
  return lines.slice(start + 1, end);
}

function itemBlocks(
  regionLines: string[],
  sections: string[],
): Array<{ section: string | null; block: string[] }> {
  const starts: number[] = [];
  regionLines.forEach((ln, i) => {
    if (ln.startsWith("FROM:")) starts.push(i);
  });
  if (starts.length === 0) return [];

  const boundarySet = new Set<number>(starts);
  regionLines.forEach((ln, i) => {
    if (sections.includes(ln)) boundarySet.add(i);
  });

  const blocks: Array<{ section: string | null; block: string[] }> = [];
  for (const idx of starts) {
    let section: string | null = null;
    for (let j = idx; j >= 0; j--) {
      const line = regionLines[j] ?? "";
      if (sections.includes(line)) {
        section = line;
        break;
      }
    }
    let end = regionLines.length;
    for (let j = idx + 1; j < regionLines.length; j++) {
      if (boundarySet.has(j)) {
        end = j;
        break;
      }
    }
    blocks.push({ section, block: regionLines.slice(idx, end) });
  }
  return blocks;
}

function senderFromBlock(block: string[]): string | null {
  const head = block[0] ?? "";
  const rest = head.slice("FROM:".length).trim();
  if (rest) return rest;
  return block[1] ?? null;
}

function parseMailRegion(lines: string[]): string[] {
  const r = region(lines, "MAIL", "PACKAGES");
  const senders: string[] = [];
  for (const { block } of itemBlocks(r, MAIL_SECTIONS)) {
    const s = senderFromBlock(block);
    if (s) senders.push(s);
  }
  return senders;
}

function parsePackageRegion(lines: string[]): PackageInfo[] {
  const r = region(lines, "PACKAGES", null);
  const packages: PackageInfo[] = [];
  for (const { section, block } of itemBlocks(r, PACKAGE_SECTIONS)) {
    if (block.some((ln) => EMPTY_MARKERS.includes(ln))) continue;
    const pkg: PackageInfo = {
      sender: senderFromBlock(block),
      status: section,
      tracking: null,
      eta: null,
    };
    for (const ln of block) {
      if (pkg.tracking === null) {
        const m = TRACKING_RE.exec(ln);
        if (m) pkg.tracking = m[1] ?? null;
      }
      if (pkg.eta === null) {
        const m = ETA_RE.exec(ln);
        if (m) pkg.eta = (m[1] ?? "").trim();
      }
    }
    packages.push(pkg);
  }
  return packages;
}

// --- image extraction ------------------------------------------------------

function attachmentName(att: Attachment): string | null {
  const cid = (att.contentId ?? "").trim().replace(/^<|>$/g, "");
  return att.filename ?? (cid || null);
}

function toBuffer(c: Attachment["content"]): Buffer {
  if (typeof c === "string") return Buffer.from(c, "utf8");
  if (c instanceof ArrayBuffer) return Buffer.from(new Uint8Array(c));
  return Buffer.from(c);
}

function extractImages(attachments: Attachment[]): { scans: Scan[]; dropped: string[] } {
  const scans: Scan[] = [];
  const dropped: string[] = [];
  for (const att of attachments) {
    if (!att.mimeType.startsWith("image/")) continue;
    const name = attachmentName(att);
    if (!name) continue;
    if (isAdAttachment(name)) {
      dropped.push(name);
      continue;
    }
    const data = toBuffer(att.content);
    if (data.length === 0) continue;
    scans.push({ filename: name, contentType: att.mimeType, data, cid: "", listedSender: null });
  }
  scans.forEach((s, i) => {
    s.cid = `scan${i}@usps-digest`;
  });
  return { scans, dropped };
}

// --- date parsing ----------------------------------------------------------

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parseMonth(name: string): number | null {
  const lower = name.toLowerCase().slice(0, 3);
  const idx = MONTHS.findIndex((m) => m.toLowerCase().slice(0, 3) === lower);
  return idx === -1 ? null : idx;
}

function parseDigestDate(
  lines: string[],
  subject: string,
  sentAt: Date | null,
): { date: Date | null; text: string } {
  const flat = lines.join(" ");
  const m = DATE_RE.exec(flat);
  if (m) {
    const month = parseMonth(m[2] ?? "");
    if (month !== null) {
      const day = Number(m[1]);
      const year = Number(m[3]);
      const d = new Date(Date.UTC(year, month, day));
      if (!Number.isNaN(d.getTime())) return { date: d, text: m[0] };
    }
  }
  const sm = SUBJECT_DATE_RE.exec(subject);
  if (sm) {
    const year = sentAt?.getUTCFullYear() ?? new Date().getUTCFullYear();
    const d = new Date(Date.UTC(year, Number(sm[1]) - 1, Number(sm[2])));
    if (!Number.isNaN(d.getTime())) return { date: d, text: sm[0] };
  }
  return { date: null, text: "" };
}

// --- top-level parse -------------------------------------------------------

export async function parseDigest(raw: Buffer): Promise<Digest> {
  const parser = new PostalMime();
  const email = await parser.parse(raw);

  const subject = email.subject ?? "";
  const fromAddress = email.from?.address ?? null;
  const sentAt = email.date ? new Date(email.date) : null;

  const html = email.html ?? "";
  const text = email.text ?? "";

  const lines = html
    ? htmlToLines(html)
    : rejoinFragments(
        text
          .split("\n")
          .map(clean)
          .filter((l) => l.length > 0),
      );
  const trimmed = truncateAtFooter(lines);

  const { scans, dropped } = extractImages(email.attachments);
  const cidSenders = html ? mapCidSenders(html) : new Map<string, string>();
  for (const scan of scans) {
    scan.listedSender = cidSenders.get(scan.filename) ?? null;
  }

  const { date: digestDate, text: dateText } = parseDigestDate(trimmed, subject, sentAt);

  let announcedMail = 0;
  let announcedPackages = 0;
  const cm = COUNTS_RE.exec(trimmed.join(" "));
  if (cm) {
    announcedMail = Number(cm[1]);
    announcedPackages = Number(cm[2]);
  }

  const campaignSenders = parseMailRegion(trimmed);
  const packages = parsePackageRegion(trimmed);

  const hiddenMailCount = Math.max(0, announcedMail - scans.length);
  const have = new Set(scans.map((s) => s.listedSender).filter((s): s is string => !!s));
  const sendersWithoutScans = [...new Set(campaignSenders)].filter((s) => !have.has(s));

  return {
    subject,
    from: fromAddress,
    sentAt: sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt : null,
    digestDate,
    dateText,
    announcedMail,
    announcedPackages,
    scans,
    campaignSenders,
    packages,
    droppedAds: dropped,
    hiddenMailCount,
    sendersWithoutScans,
  };
}

// ---------------------------------------------------------------------------
// Rendering the clean digest.
// ---------------------------------------------------------------------------

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const INK = "#1c1e21";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
const ACCENT = "#1a4d8f";
const CARD = "#ffffff";
const BG = "#f4f5f7";
const WARN_BG = "#fff8e6";
const WARN_BORDER = "#f0c36d";
const WARN_INK = "#7a5b12";
const TRACKING_URL = "https://tools.usps.com/go/TrackConfirmAction?tLabels={}";

function plural(n: number, word: string): string {
  return n === 1 ? `${n} ${word}` : `${n} ${word}s`;
}

function dateLabel(d: Digest): string {
  if (d.digestDate) {
    return d.digestDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  return d.dateText || "Today";
}

function shortDate(d: Digest): string {
  if (d.digestDate) {
    return d.digestDate.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  return d.dateText || "today";
}

function sectionTitle(text: string): string {
  return (
    `<tr><td style="padding:26px 24px 8px 24px;font:600 12px ${FONT};` +
    `letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">${esc(text)}</td></tr>`
  );
}

interface CardOpts {
  table?: string;
  outer?: string;
}

function card(inner: string, opts: CardOpts = {}): string {
  const table = opts.table ? ` style="${opts.table}"` : "";
  return (
    `<tr><td style="padding:${opts.outer ?? "10px 24px"};">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${table}>` +
    inner +
    `</table></td></tr>`
  );
}

function packageRow(pkg: PackageInfo): string {
  const sender = esc(pkg.sender || "Unknown sender");
  const lines = [`<div style="font:600 15px ${FONT};color:${INK};">${sender}</div>`];
  const meta: string[] = [];
  if (pkg.status) meta.push(esc(pkg.status));
  if (pkg.eta) meta.push(esc(pkg.eta));
  if (meta.length) {
    lines.push(
      `<div style="font:400 13px ${FONT};color:${ACCENT};margin-top:3px;">${meta.join(" · ")}</div>`,
    );
  }
  if (pkg.tracking) {
    lines.push(
      `<div style="margin-top:4px;"><a href="${TRACKING_URL.replace("{}", esc(pkg.tracking))}" ` +
        `style="font:400 12px ui-monospace,SFMono-Regular,Menlo,monospace;color:${MUTED};` +
        `text-decoration:none;border-bottom:1px dotted ${BORDER};">${esc(pkg.tracking)}</a></div>`,
    );
  }
  return card(
    `<tr><td style="padding:12px 14px;background:${CARD};border:1px solid ${BORDER};` +
      `border-radius:8px;">${lines.join("")}</td></tr>`,
  );
}

function scanBlock(scan: Scan): string {
  const sender = esc(scan.listedSender || "Unknown sender");
  return card(
    `<tr><td style="padding:14px 14px 10px 14px;">` +
      `<div style="font:700 19px ${FONT};color:${INK};line-height:1.25;">${sender}</div>` +
      `</td></tr>` +
      `<tr><td style="padding:0 14px 14px 14px;">` +
      `<img src="cid:${scan.cid}" alt="Scan of mail from ${sender}" width="100%" ` +
      `style="display:block;width:100%;max-width:100%;height:auto;border:1px solid ${BORDER};` +
      `border-radius:6px;"></td></tr>`,
    { table: `background:${CARD};border:1px solid ${BORDER};border-radius:8px;` },
  );
}

function hiddenNotice(d: Digest): string {
  const n = d.hiddenMailCount;
  if (n <= 0) return "";
  let who = "";
  if (d.sendersWithoutScans.length) {
    who = ` Replaced by advertising from: <strong>${esc(d.sendersWithoutScans.join(", "))}</strong>.`;
  }
  const piece = n === 1 ? "mailpiece" : "mailpieces";
  return card(
    `<tr><td style="padding:12px 14px;background:${WARN_BG};border:1px solid ${WARN_BORDER};` +
      `border-radius:8px;font:400 13px ${FONT};color:${WARN_INK};">` +
      `USPS did not provide a scan for <strong>${n} ${piece}</strong>.${who}` +
      `</td></tr>`,
    { outer: "10px 24px 4px 24px" },
  );
}

export function cleanSubject(d: Digest): string {
  const bits: string[] = [];
  if (d.announcedMail) bits.push(plural(d.announcedMail, "mailpiece"));
  if (d.announcedPackages) bits.push(plural(d.announcedPackages, "package"));
  const tail = bits.length ? bits.join(" · ") : "nothing expected";
  return `Mail for ${shortDate(d)} — ${tail}`;
}

function buildHtml(d: Digest): string {
  const rows: string[] = [
    `<tr><td style="padding:24px 24px 0 24px;">` +
      `<div style="font:700 24px ${FONT};color:${INK};">${esc(dateLabel(d))}</div>` +
      `<div style="font:400 14px ${FONT};color:${MUTED};margin-top:4px;">` +
      `${plural(d.announcedMail, "mailpiece")} · ${plural(d.announcedPackages, "package")}` +
      `</div></td></tr>`,
  ];

  if (d.packages.length) {
    rows.push(sectionTitle("Packages"));
    for (const pkg of d.packages) rows.push(packageRow(pkg));
  }

  if (d.scans.length) {
    rows.push(sectionTitle("Mail"));
    for (const scan of d.scans) rows.push(scanBlock(scan));
  } else if (d.announcedMail) {
    rows.push(sectionTitle("Mail"));
  }

  rows.push(hiddenNotice(d));

  if (!d.packages.length && !d.scans.length && !d.announcedMail) {
    rows.push(
      `<tr><td style="padding:24px;font:400 14px ${FONT};color:${MUTED};">Nothing expected.</td></tr>`,
    );
  }

  return (
    `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:${BG};">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="background:${BG};"><tr><td align="center" style="padding:20px 0;">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" ` +
    `style="max-width:560px;width:100%;background:${CARD};border:1px solid ${BORDER};` +
    `border-radius:12px;">${rows.join("")}</table></td></tr></table></body></html>`
  );
}

export interface BuildOptions {
  from: string;
  to: string;
}

export function buildCleanMessage(d: Digest, opts: BuildOptions): Promise<Buffer> {
  const composer = new MailComposer({
    from: opts.from,
    to: opts.to,
    subject: cleanSubject(d),
    date: d.sentAt ?? new Date(),
    html: buildHtml(d),
    attachments: d.scans.map((s) => ({
      filename: s.filename,
      content: s.data,
      cid: s.cid,
      contentType: s.contentType,
    })),
  });
  return composer.compile().build();
}
