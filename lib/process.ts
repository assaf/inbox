import { session, unprocessedDigestIds, rawEmail, importEmail, markProcessed } from "./jmap.js";
import { rebuildDigest } from "./clean.js";

export interface ProcessResult {
  processed: number;
  failed: number;
}

/**
 * Find every USPS digest that has not been cleaned yet, rebuild it, import the
 * clean copy into the Inbox, then mark + archive the original. One digest's
 * failure never blocks the rest; the cron pass retries on the next cycle.
 */
export async function processNewDigests(limit?: number): Promise<ProcessResult> {
  let ids = await unprocessedDigestIds();
  if (limit !== undefined) ids = ids.slice(0, limit);
  const s = await session();

  let processed = 0;
  let failed = 0;

  for (const id of ids) {
    try {
      const email = await rawEmail(id);
      const { digest, clean } = await rebuildDigest(email.raw, s.username);
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
