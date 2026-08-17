import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../lib/config.js";
import { decryptPushBody } from "../lib/decrypt.js";
import { setVerificationCode } from "../lib/jmap.js";
import { processNewDigests } from "../lib/process.js";

const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB — a push payload is a few KB

function readBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (Buffer.isBuffer(req.body)) {
      if (req.body.length > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        return;
      }
      resolve(req.body);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(c));
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  let payload;
  try {
    const body = await readBody(req);
    payload = decryptPushBody(body, env("PUSH_PRIVATE_KEY"), env("PUSH_AUTH"));
  } catch (err) {
    console.error("[push] decrypt failed:", err);
    res.status(400).json({ error: "decrypt failed" });
    return;
  }

  const type = payload["@type"];

  if (type === "PushVerification") {
    const id = String(payload["pushSubscriptionId"] ?? "");
    const code = String(payload["verificationCode"] ?? "");
    try {
      await setVerificationCode(id, code);
      console.info(`[push] verified subscription ${id}`);
    } catch (err) {
      console.error("[push] verification update failed:", err);
      res.status(500).json({ error: "verification failed" });
      return;
    }
  } else if (type === "StateChange") {
    // Best effort. The 15-minute cron is the catch-up net for anything missed.
    try {
      await processNewDigests(1);
    } catch (err) {
      console.error("[push] processing failed:", err);
    }
  } else {
    console.warn(`[push] unknown payload type: ${type}`);
  }

  res.status(200).json({ ok: true });
}
