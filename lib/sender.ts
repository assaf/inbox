import { envOpt } from "./config.js";
import { bearer } from "./http.js";
import type { Digest } from "./digest.js";

const CF_API = "https://api.cloudflare.com/client/v4/accounts";
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const PROMPT =
  "The return address in the top-left corner of this envelope shows who sent " +
  "this mail. Read it and tell me the sender's name only. Do not include the " +
  "recipient's name or address.";

interface CfError {
  code: number;
  message: string;
}

interface VisionResult {
  success?: boolean;
  errors?: CfError[];
  result?: { response?: string | null };
}

function configured(): boolean {
  return Boolean(envOpt("CLOUDFLARE_ACCOUNT_ID") && envOpt("CLOUDFLARE_API_TOKEN"));
}

async function cfRun(model: string, body: unknown): Promise<Response | null> {
  const accountId = envOpt("CLOUDFLARE_ACCOUNT_ID");
  const token = envOpt("CLOUDFLARE_API_TOKEN");
  if (!accountId || !token) return null;
  return fetch(`${CF_API}/${accountId}/ai/run/${model}`, {
    method: "POST",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let licenseAgreed = false;

/**
 * llama-3.2-11b-vision requires accepting Meta's license before the first
 * inference. Sending `prompt: "agree"` once accepts it (idempotent — a repeat
 * call errors harmlessly).
 */
async function ensureLicense(): Promise<void> {
  if (licenseAgreed) return;
  licenseAgreed = true;
  try {
    await cfRun(VISION_MODEL, { prompt: "agree", stream: false });
  } catch {
    // ignore — license either accepted or already accepted
  }
}

async function runVision(prompt: string, image: Buffer): Promise<string | null> {
  const model = envOpt("CLOUDFLARE_OCR_MODEL") ?? VISION_MODEL;
  const res = await cfRun(model, {
    prompt,
    image: Array.from(image),
    stream: false,
    max_tokens: 48,
    temperature: 0,
  });
  if (!res) return null;
  const text = await res.text();
  if (!res.ok) {
    console.warn(`[sender] Cloudflare vision failed: ${res.status} ${text.slice(0, 300)}`);
    return null;
  }
  try {
    const j = JSON.parse(text) as VisionResult;
    if (j.errors?.length) return null;
    return j.result?.response?.trim() ?? null;
  } catch {
    return null;
  }
}

export async function ocrSender(image: Buffer): Promise<string | null> {
  if (!configured()) return null;
  await ensureLicense();
  const raw = await runVision(PROMPT, image);
  return raw ? cleanSender(raw) : null;
}

function cleanSender(raw: string): string | null {
  const line = raw
    .replace(/\*\*/g, "")
    .split("\n")
    .map((l) =>
      l
        .replace(/^sender'?s?\s+name\s*:?\s*/i, "")
        .replace(/^the\s+sender'?s?\s+name\s+is\s*/i, "")
        .trim(),
    )
    .find((l) => l.length > 0);
  if (!line) return null;
  const s = line.replace(/[.]+$/, "").trim();
  if (s.length === 0 || /^unknown$/i.test(s)) return null;
  return s.length > 80 ? s.slice(0, 80) : s;
}

/** Fill in listedSender for scans missing one. No-op when unconfigured. */
export async function enrichSenders(digest: Digest): Promise<void> {
  if (!configured()) return;
  const targets = digest.scans.filter((s) => !s.listedSender);
  await Promise.all(
    targets.map(async (scan) => {
      scan.listedSender = await ocrSender(scan.data);
    }),
  );
}
