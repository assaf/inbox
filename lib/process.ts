import { session, unprocessedDigestIds, rawEmail, importEmail, markProcessed } from "./jmap.js";
import { parseDigest, buildCleanMessage } from "./digest.js";

export interface ProcessResult {
  processed: number;
  failed: number;
}

/**
 * Find every USPS digest that has not been cleaned yet, rebuild it, import the
 * clean copy into the Inbox, then mark + archive the original. One digest's
 * failure never blocks the rest; the cron pass retries on the next cycle.
 */
export async function processNewDigests(): Promise<ProcessResult> {
  const ids = await unprocessedDigestIds();
  const s = await session();

  let processed = 0;
  let failed = 0;

  for (const id of ids) {
    try {
      const email = await rawEmail(id);
      const digest = await parseDigest(email.raw);
      const clean = await buildCleanMessage(digest, {
        from: digest.from ?? "USPSInformedDelivery@usps.gov",
        to: s.username,
      });
      await importEmail(clean, email.receivedAt);
      await markProcessed(id);
      processed++;
      console.info(
        `[inbox] cleaned digest "${email.subject}": ${digest.scans.length} scans kept, ` +
          `${digest.droppedAds.length} ads dropped, ${digest.packages.length} packages`,
      );
    } catch (err) {
      failed++;
      console.error(`[inbox] failed to process digest ${id}:`, err);
    }
  }

  return { processed, failed };
}
