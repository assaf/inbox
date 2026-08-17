import type { VercelRequest, VercelResponse } from "@vercel/node";
import { envOpt } from "../lib/config.js";
import { log } from "../lib/log.js";
import { processNewDigests } from "../lib/process.js";
import { safeEqual } from "../lib/secure.js";
import { ensureSubscription } from "../lib/subscription.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = envOpt("CRON_SECRET");
  if (secret && !safeEqual(req.headers.authorization ?? "", `Bearer ${secret}`)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    // Two jobs in one daily tick: renew an expiring push subscription, and
    // process any digests that arrived without a push (the catch-up net).
    const subscriptionId = await ensureSubscription();
    const { processed, failed } = await processNewDigests();
    res.status(200).json({ ok: true, subscriptionId, processed, failed });
  } catch (err) {
    log.error("cron failed", { err: String(err) });
    res.status(500).json({ error: "cron failed" });
  }
}
