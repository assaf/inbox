import type { VercelRequest, VercelResponse } from "@vercel/node";
import { envDefault, envOpt } from "../lib/config.js";
import { listMailboxes, listSubscriptions } from "../lib/jmap.js";

interface SmokeStatus {
  ok: boolean;
  jmap: boolean;
  pushSubscription: boolean;
  cloudflareOcr: boolean;
}

/**
 * Health check for the deployed pipeline: JMAP reachable, push subscription
 * live, and OCR configured. Secret-gated — disabled (404) unless
 * SMOKE_TEST_SECRET is set; send it in the `x-smoke-secret` header.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = envOpt("SMOKE_TEST_SECRET");
  if (!secret) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (req.headers["x-smoke-secret"] !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const status: SmokeStatus = {
    ok: true,
    jmap: false,
    pushSubscription: false,
    cloudflareOcr: false,
  };

  try {
    const boxes = await listMailboxes();
    status.jmap = boxes.length > 0;
  } catch (err) {
    console.error("[smoke] jmap check failed:", err);
  }

  try {
    const deviceId = envDefault("DEVICE_CLIENT_ID", "usps-digest-cleaner");
    const subs = await listSubscriptions();
    status.pushSubscription = subs.some((s) => s.deviceClientId === deviceId);
  } catch (err) {
    console.error("[smoke] subscription check failed:", err);
  }

  status.cloudflareOcr = Boolean(envOpt("CLOUDFLARE_ACCOUNT_ID") && envOpt("CLOUDFLARE_API_TOKEN"));
  status.ok = status.jmap && status.pushSubscription && status.cloudflareOcr;

  res.status(status.ok ? 200 : 500).json(status);
}
