import type { VercelRequest, VercelResponse } from "@vercel/node";
import { envOpt } from "../lib/config.js";
import { log } from "../lib/log.js";
import { processNewDigests } from "../lib/process.js";
import { safeEqual } from "../lib/secure.js";
import { ensureSubscription } from "../lib/subscription.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Required, not optional: Vercel cron requests carry no built-in
  // authentication, so a deployment without CRON_SECRET would leave the
  // endpoint open to anyone who can reach the URL.
  const secret = envOpt("CRON_SECRET");
  if (!secret) {
    log.error("cron secret not configured");
    res.status(500).json({ error: "cron not configured" });
    return;
  }
  if (!safeEqual(req.headers.authorization ?? "", `Bearer ${secret}`)) {
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
