import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { rawEmail, session, unprocessedDigestIds } from "../lib/jmap.js";
import { buildCleanMessage, parseDigest } from "../lib/digest.js";
import { enrichSenders } from "../lib/sender.js";

const outDir = resolve(process.cwd(), "out");

function safeName(s: string): string {
  return s
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 90);
}

/**
 * Read-only test: fetch every unprocessed digest, parse it, and write the
 * rebuilt clean message to out/*.eml. Never imports or archives anything.
 */
async function main(): Promise<void> {
  const s = await session();
  const ids = await unprocessedDigestIds();
  console.info(`[dry-run] ${s.username}: ${ids.length} unprocessed digest(s)`);

  mkdirSync(outDir, { recursive: true });

  let wrote = 0;
  for (const id of ids) {
    try {
      const email = await rawEmail(id);
      const digest = await parseDigest(email.raw);
      await enrichSenders(digest);
      const clean = await buildCleanMessage(digest, {
        from: digest.from ?? "USPSInformedDelivery@email.informeddelivery.usps.com",
        to: s.username,
      });
      const stamp = safeName(email.receivedAt.replace(/[:.]/g, "-"));
      const file = `${stamp} ${safeName(email.subject)}.eml`;
      writeFileSync(resolve(outDir, file), clean);
      wrote++;
      console.info(`[dry-run] "${email.subject}" -> out/${file}`);
      console.info(
        `[dry-run]   kept ${digest.scans.length} scans, dropped ${digest.droppedAds.length} ads, ${digest.packages.length} packages`,
      );
    } catch (err) {
      console.error(`[dry-run] failed ${id}:`, err);
    }
  }

  console.info(`[dry-run] wrote ${wrote}/${ids.length} clean .eml files. Inbox NOT modified.`);
}

main().catch((err) => {
  console.error("[dry-run] fatal:", err);
  process.exit(1);
});
