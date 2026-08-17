import type { VercelRequest, VercelResponse } from "@vercel/node";
import { envOpt } from "../lib/config.js";
import { ensureSubscription } from "../lib/subscription.js";
import { processNewDigests } from "../lib/process.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = envOpt("CRON_SECRET");
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const subscriptionId = await ensureSubscription();
    const result = await processNewDigests();
    res.status(200).json({ ok: true, subscriptionId, ...result });
  } catch (err) {
    console.error("[cron] failed:", err);
    res.status(500).json({ error: "cron failed" });
  }
}
