import { session, unprocessedDigestIds, rawEmail, importEmail, markProcessed } from "./jmap.js";
import { rebuildDigest } from "./clean.js";

export interface ProcessResult {
  processed: number;
  failed: number;
}

/**
 * Rebuild + import one or more unprocessed digests. Each digest is marked
 * processed BEFORE the slow rebuild+import: the import fires a StateChange
 * push, and a concurrent re-run must see the digest as already handled, or it
 * re-processes the same digest and creates duplicate clean copies.
 */
export async function processNewDigests(limit?: number): Promise<ProcessResult> {
  let ids = await unprocessedDigestIds();
  if (limit !== undefined) ids = ids.slice(0, limit);
  const s = await session();

  let processed = 0;
  let failed = 0;

  for (const id of ids) {
    await markProcessed(id);
    try {
      const email = await rawEmail(id);
      const { digest, clean } = await rebuildDigest(email.raw, s.username);
      await importEmail(clean, email.receivedAt);
      processed++;
      console.info(
        `[inbox] cleaned digest "${email.subject}": ${digest.scans.length} scans kept, ` +
          `${digest.droppedAds.length} ads dropped, ${digest.packages.length} packages`,
      );
    } catch (err) {
      // No rollback: Fastmail won't remove the $usps-processed keyword, so a
      // digest that reaches this point stays marked and is skipped next time.
      // The original email remains in the Inbox, so nothing is lost.
      failed++;
      console.error(`[inbox] failed to process digest ${id}:`, err);
    }
  }

  return { processed, failed };
}
