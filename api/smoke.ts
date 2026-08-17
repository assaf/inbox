import type { VercelRequest, VercelResponse } from "@vercel/node";
import { envOpt } from "../lib/config.js";
import { safeEqual } from "../lib/secure.js";
import { collectStatus } from "../lib/status.js";

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
  if (!safeEqual(String(req.headers["x-smoke-secret"] ?? ""), secret)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const status = await collectStatus();
  const ok = status.jmapOk && status.pushOk && status.ocrOk;
  res.status(ok ? 200 : 500).json({
    ok,
    jmap: status.jmapOk,
    pushSubscription: status.pushOk,
    cloudflareOcr: status.ocrOk,
  });
}
