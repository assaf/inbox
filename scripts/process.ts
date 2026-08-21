import { processNewDigests } from "../lib/process.js";

/**
 * Live run: import the clean copy into the Inbox and trash the original.
 * Destructive — run scripts/dry-run.ts first and inspect out/*.eml.
 * Optional arg limits how many digests to process (test with `pnpm process 1`).
 */
const limitArg = process.argv[2];
const limit = limitArg ? Number(limitArg) : undefined;
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
  console.error("[process] usage: tsx scripts/process.ts [count]");
  process.exit(1);
}

processNewDigests(limit)
  .then((r) => {
    console.info(`[process] done: ${r.processed} cleaned, ${r.failed} failed`);
  })
  .catch((err) => {
    console.error("[process] fatal:", err);
    process.exit(1);
  });
