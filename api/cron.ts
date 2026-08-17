import type { VercelRequest, VercelResponse } from "@vercel/node";
import { envOpt } from "../lib/config.js";
import { safeEqual } from "../lib/secure.js";
import { ensureSubscription } from "../lib/subscription.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = envOpt("CRON_SECRET");
  if (secret && !safeEqual(req.headers.authorization ?? "", `Bearer ${secret}`)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const subscriptionId = await ensureSubscription();
    res.status(200).json({ ok: true, subscriptionId });
  } catch (err) {
    console.error("[cron] failed:", err);
    res.status(500).json({ error: "cron failed" });
  }
}
