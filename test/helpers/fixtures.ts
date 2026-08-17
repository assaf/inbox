import { parseDigest, type Digest } from "../../lib/digest.js";

export interface FixtureImage {
  filename: string;
  bytes: Buffer;
}

export interface FixtureOpts {
  subject: string;
  html: string;
  images?: FixtureImage[];
  from?: string;
  date?: string;
}

const BOUNDARY = "fixture-boundary";

/**
 * Build a minimal multipart/related MIME message the way USPS does: an HTML
 * body plus inline images referenced by `cid:`. The image's Content-Disposition
 * filename and Content-ID both carry the same name, matching the real digest
 * (where the cid in the HTML equals the image part's filename).
 */
export function buildEml(opts: FixtureOpts): Buffer {
  const header = [
    `From: ${opts.from ?? "USPSInformeddelivery@email.informeddelivery.usps.com"}`,
    "To: someone@example.com",
    `Subject: ${opts.subject}`,
    `Date: ${opts.date ?? "Sat, 15 Aug 2026 14:21:50 +0000"}`,
    "Message-ID: <fixture@example.com>",
    "MIME-Version: 1.0",
    `Content-Type: multipart/related; boundary="${BOUNDARY}"`,
    "",
  ];

  const parts = [
    `--${BOUNDARY}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.html,
  ];

  for (const img of opts.images ?? []) {
    parts.push(
      `--${BOUNDARY}`,
      "Content-Type: image/jpeg",
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: inline; filename="${img.filename}"`,
      `Content-ID: <${img.filename}>`,
      "",
      img.bytes.toString("base64"),
    );
  }

  parts.push(`--${BOUNDARY}--`, "");

  return Buffer.from([...header, ...parts].join("\r\n"), "utf8");
}

export function fakeImage(name: string): FixtureImage {
  return { filename: name, bytes: Buffer.from(`fake-image-bytes-for-${name}`) };
}

// --- fixture definitions ----------------------------------------------------

/** 2 mailpieces announced: one real scan (Example Bank) + one displaced by an
 *  ad (save-select homes); one package with tracking + ETA. */
export const typicalDay: FixtureOpts = {
  subject: "Your Daily Digest for Sat, 8/7 is ready to view",
  html: `
<div>You have 2 mailpiece(s) and 1 inbound package(s)</div>
<div>MAIL</div>
<div>
  <div>Expected Today</div>
  <div><span>FROM:</span><span>Example Bank</span>
    <img src="cid:2989542530-068.jpg" /><img src="cid:content-1201908387.jpg" /></div>
  <div>FROM: save-select homes
    <img src="cid:mailer-1202017988.jpg" /><img src="cid:content-1202017988.jpg" /></div>
</div>
<div>PACKAGES</div>
<div>
  <div>Expected 1-2 Days</div>
  <div>FROM: SHIPFUSION INC</div>
  <div>Tracking Number: 9261290335949247070387</div>
  <div>Tracking Number: 9261290335949247070387</div>
  <div>Estimated Delivery on: Aug 08</div>
</div>
<div>Refer via Email</div>`,
  images: [
    fakeImage("2989542530-068.jpg"),
    fakeImage("content-1201908387.jpg"),
    fakeImage("mailer-1202017988.jpg"),
    fakeImage("content-1202017988.jpg"),
  ],
};

/** Every mailpiece displaced by an advertiser: 0 real scans, 4 ads. */
export const adOnlyDay: FixtureOpts = {
  subject: "Your Daily Digest for Fri, 8/5 is ready to view",
  html: `
<div>You have 2 mailpiece(s) and 0 inbound package(s)</div>
<div>MAIL</div>
<div>
  <div>Expected Today</div>
  <div><span>FROM:</span><span>Lands' End</span>
    <img src="cid:mailer-1202018058.jpg" /><img src="cid:content-1202018058.jpg" /></div>
  <div>FROM: save-select homes
    <img src="cid:mailer-1202017988.jpg" /><img src="cid:content-1202017988.jpg" /></div>
</div>
<div>PACKAGES</div>
<div>No packages are available to display.</div>
<div>Refer via Email</div>`,
  images: [
    fakeImage("mailer-1202018058.jpg"),
    fakeImage("content-1202018058.jpg"),
    fakeImage("mailer-1202017988.jpg"),
    fakeImage("content-1202017988.jpg"),
  ],
};

/** No mail, two packages. */
export const noMailDay: FixtureOpts = {
  subject: "Your Daily Digest for Tue, 8/2 is ready to view",
  html: `
<div>You have 0 mailpiece(s) and 2 inbound package(s)</div>
<div>MAIL</div>
<div>No mail is available to display.</div>
<div>PACKAGES</div>
<div>
  <div>Expected Today</div>
  <div>FROM: AMAZON</div>
  <div>Tracking Number: 9374889692090765123487</div>
</div>
<div>
  <div>Expected Today</div>
  <div>FROM: EXPRESS SCRIPTS PHARMACY</div>
  <div>Tracking Number: 9405511899223976012948</div>
</div>
<div>Refer via Email</div>`,
  images: [],
};

export async function parseFixture(fixture: FixtureOpts): Promise<Digest> {
  return parseDigest(buildEml(fixture));
}
