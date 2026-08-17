import { digestSenderExact } from "./config.js";
import { session, unprocessedDigestIds, rawEmail, importEmail, markProcessed } from "./jmap.js";
import { rebuildDigest } from "./clean.js";
import { log } from "./log.js";

export interface ProcessResult {
  processed: number;
  failed: number;
}

const BATCH = 10; // matches the Email/query limit in unprocessedDigestIds()
const MAX_TOTAL = 30; // safety cap on digests per invocation
const TIME_BUDGET_MS = 40_000; // headroom inside Vercel's 60s maxDuration

/**
 * The JMAP query filter is a loose substring match, and SMTP From headers are
 * trivially spoofable — an attacker who can email the account could otherwise
 * get a crafted "digest" processed and imported. Require the exact sender
 * address (case-insensitive) before spending a blob download, OCR, or import.
 */
function matchesDigestSender(from: string | null | undefined): boolean {
  return !!from && from.toLowerCase() === digestSenderExact().toLowerCase();
}

/**
 * Rebuild + import unprocessed digests. Each digest is marked processed
 * BEFORE the slow rebuild+import: the import fires a StateChange push, and a
 * concurrent re-run must see the digest as already handled, or it
 * re-processes the same digest and creates duplicate clean copies.
 *
 * With no limit, drains the whole backlog: re-queries after each batch (marked
 * digests drop out of the query) until empty, bounded by MAX_TOTAL and
 * TIME_BUDGET_MS so a huge backlog can't blow the function timeout.
 */
export async function processNewDigests(limit?: number): Promise<ProcessResult> {
  const started = Date.now();
  let processed = 0;
  let failed = 0;

  while (true) {
    const ids = await unprocessedDigestIds();
    if (ids.length === 0) break;
    const batch = limit !== undefined ? ids.slice(0, limit) : ids;

    for (const id of batch) {
      await markProcessed(id);
      try {
        const s = await session();
        const email = await rawEmail(id);
        if (!matchesDigestSender(email.from)) {
          log.warn("skipping digest from unexpected sender", { id, from: email.from });
          continue;
        }
        const { digest, clean } = await rebuildDigest(email.raw, s.username);
        await importEmail(clean, email.receivedAt);
        processed++;
        log.info("cleaned digest", {
          id,
          subject: email.subject,
          scans: digest.scans.length,
          droppedAds: digest.droppedAds.length,
          packages: digest.packages.length,
        });
      } catch (err) {
        // No rollback: Fastmail won't remove the $usps-processed keyword, so a
        // digest that reaches this point stays marked and is skipped next time.
        // The original email remains in the Inbox, so nothing is lost.
        failed++;
        log.error("failed to process digest", { id, err: String(err) });
      }
    }

    if (limit !== undefined) break; // caller asked for at most one batch
    if (ids.length < BATCH) break; // drained
    if (processed + failed >= MAX_TOTAL) break;
    if (Date.now() - started > TIME_BUDGET_MS) break;
  }

  return { processed, failed };
}
