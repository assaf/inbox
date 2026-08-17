import { describe, it, expect } from "vitest";
import PostalMime from "postal-mime";
import {
  isAdAttachment,
  rejoinFragments,
  mapCidSenders,
  parseDigest,
  buildCleanMessage,
  cleanSubject,
} from "../lib/digest.js";
import { buildEml, typicalDay, adOnlyDay, noMailDay } from "./helpers/fixtures.js";

/** Parse a built message back so assertions hit the decoded HTML/subject. */
function renderOut(raw: Buffer): Promise<{ html: string | null; subject: string | null; text: string }> {
  return new PostalMime().parse(raw).then((m) => ({
    html: m.html ?? null,
    subject: m.subject ?? null,
    text: raw.toString("latin1"),
  }));
}

// --- ad filename deny-list ---------------------------------------------------

describe("isAdAttachment", () => {
  it.each([
    "mailer-1202017988.jpg",
    "content-1202017988.jpg",
    "MAILER-123.JPG",
    "content-1201879456.jpg",
  ])("flags %s as an ad", (name) => {
    expect(isAdAttachment(name)).toBe(true);
  });

  it.each([
    "2989868880-068.jpg",
    "1006624496-066.jpg",
    "1002338133-067.jpg",
    "1123485347-058.jpg",
  ])("keeps real scan %s", (name) => {
    expect(isAdAttachment(name)).toBe(false);
  });
});

// --- text fragment rejoining --------------------------------------------------

describe("rejoinFragments", () => {
  it("rejoins labels USPS splits across elements", () => {
    expect(rejoinFragments(["Expected", "Today", "2", "item(s)", "FROM:", "AMAZON"])).toEqual([
      "Expected Today",
      "2 item(s)",
      "FROM:",
      "AMAZON",
    ]);
  });

  it("leaves whole labels untouched", () => {
    expect(rejoinFragments(["Expected This Week"])).toEqual(["Expected This Week"]);
  });
});

// --- positional FROM: -> cid mapping ------------------------------------------

describe("mapCidSenders", () => {
  it("attaches the nearest preceding FROM: to each cid image", () => {
    const html = `
      <div><span>FROM:</span><span>USPS HR</span>
        <img src="cid:mailer-1202018058.jpg"><img src="cid:content-1202018058.jpg"></div>
      <div><span>FROM:</span><span>Example Bank</span>
        <img src="cid:2989542530-068.jpg"><img src="cid:content-1201908387.jpg"></div>
      <div>FROM: save-select homes<img src="cid:mailer-1202017988.jpg"></div>
    `;
    const mapping = mapCidSenders(html);
    expect(mapping.get("2989542530-068.jpg")).toBe("Example Bank");
    expect(mapping.get("mailer-1202018058.jpg")).toBe("USPS HR");
    // inline "FROM: x" form, not the split-span form
    expect(mapping.get("mailer-1202017988.jpg")).toBe("save-select homes");
  });
});

// --- full parse ---------------------------------------------------------------

describe("parseDigest", () => {
  it("typical day: keeps the scan, drops the ads, reports the loss", async () => {
    const d = await parseDigest(buildEml(typicalDay));

    expect(d.announcedMail).toBe(2);
    expect(d.announcedPackages).toBe(1);

    expect(d.scans.map((s) => s.filename)).toEqual(["2989542530-068.jpg"]);
    expect(d.scans[0]?.listedSender).toBe("Example Bank");

    expect(d.droppedAds).toEqual([
      "content-1201908387.jpg",
      "mailer-1202017988.jpg",
      "content-1202017988.jpg",
    ]);

    expect(d.hiddenMailCount).toBe(1);
    expect(d.campaignSenders).toEqual(["Example Bank", "save-select homes"]);
    // the sender that DID supply a scan is not reported as "replaced"
    expect(d.sendersWithoutScans).toEqual(["save-select homes"]);
  });

  it("typical day: parses the package with tracking dedup and ETA", async () => {
    const d = await parseDigest(buildEml(typicalDay));
    expect(d.packages).toHaveLength(1);
    const pkg = d.packages[0];
    expect(pkg?.sender).toBe("SHIPFUSION INC");
    // tracking appears twice in the source; exactly one value survives
    expect(pkg?.tracking).toBe("9261290335949247070387");
    expect(pkg?.status).toBe("Expected 1-2 Days");
    expect(pkg?.eta).toBe("Aug 08");
  });

  it("ad-only day: zero scans but the loss is reported, not hidden", async () => {
    const d = await parseDigest(buildEml(adOnlyDay));

    expect(d.scans).toEqual([]);
    expect(d.droppedAds).toHaveLength(4);
    expect(d.announcedMail).toBe(2);
    expect(d.hiddenMailCount).toBe(2);
    expect(d.sendersWithoutScans).toEqual(["Lands' End", "save-select homes"]);
    expect(d.packages).toEqual([]);
  });

  it("no-mail day: zero attachments, two packages", async () => {
    const d = await parseDigest(buildEml(noMailDay));

    expect(d.scans).toEqual([]);
    expect(d.droppedAds).toEqual([]);
    expect(d.announcedMail).toBe(0);
    expect(d.hiddenMailCount).toBe(0);

    expect(d.packages).toHaveLength(2);
    expect(d.packages.map((p) => p.sender)).toEqual(["AMAZON", "EXPRESS SCRIPTS PHARMACY"]);
    // statuses survive the split-label rejoining
    expect(d.packages.every((p) => p.status === "Expected Today")).toBe(true);
    expect(d.packages.every((p) => p.tracking)).toBe(true);
  });

  it("derives the digest date from the subject when the body has none", async () => {
    const d = await parseDigest(buildEml(typicalDay));
    expect(d.digestDate?.toISOString().slice(0, 10)).toBe("2026-08-07");
  });

  it("derives the digest date from the body date line when present", async () => {
    const fixture = {
      ...typicalDay,
      subject: "Daily Digest", // no subject date
      html: `<div>Friday 7 August 2026</div>${typicalDay.html}`,
    };
    const d = await parseDigest(buildEml(fixture));
    expect(d.digestDate?.toISOString().slice(0, 10)).toBe("2026-08-07");
  });
});

// --- rendering ----------------------------------------------------------------

describe("buildCleanMessage", () => {
  it("never lets ad creative reach the output", async () => {
    for (const fixture of [typicalDay, adOnlyDay]) {
      const d = await parseDigest(buildEml(fixture));
      const out = await buildCleanMessage(d, { from: "a@b.c", to: "d@e.f" });
      const text = out.toString("latin1");
      for (const ad of d.droppedAds) {
        expect(text).not.toContain(ad);
      }
    }
  });

  it("embeds surviving scans as inline cid attachments", async () => {
    const d = await parseDigest(buildEml(typicalDay));
    const out = await buildCleanMessage(d, { from: "a@b.c", to: "d@e.f" });
    const { html, subject, text } = await renderOut(out);

    expect(text).toContain("Content-ID: <scan0@usps-digest>");
    expect(html).toContain("cid:scan0@usps-digest");
    expect(html).toContain("Example Bank");
    // the clean subject summarizes counts
    expect(subject).toContain("2 mailpieces");
  });

  it("renders the hidden-mail notice on ad-only days", async () => {
    const d = await parseDigest(buildEml(adOnlyDay));
    const out = await buildCleanMessage(d, { from: "a@b.c", to: "d@e.f" });
    const { html } = await renderOut(out);
    expect(html).toContain("did not provide a scan for <strong>2 mailpieces</strong>");
    expect(html).toContain("Lands' End");
  });

  it("uses inline styles only (email-client safe)", async () => {
    const d = await parseDigest(buildEml(typicalDay));
    const out = await buildCleanMessage(d, { from: "a@b.c", to: "d@e.f" });
    const { html } = await renderOut(out);
    expect(html).toContain('charset="utf-8"');
    expect(html).not.toContain("<style");
    expect(html).not.toContain("display:flex");
  });
});

// --- subject -------------------------------------------------------------------

describe("cleanSubject", () => {
  it("summarizes mailpiece and package counts", async () => {
    const d = await parseDigest(buildEml(typicalDay));
    expect(cleanSubject(d)).toBe("Mail for Fri, Aug 7 — 2 mailpieces · 1 package");
  });

  it("says 'nothing expected' when empty", async () => {
    const d = await parseDigest(buildEml(noMailDay));
    // 0 mail, 2 packages -> packages still counted
    expect(cleanSubject(d)).toBe("Mail for Sun, Aug 2 — 2 packages");
  });
});
