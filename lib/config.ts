import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Minimal .env loader (no dependency). Real env vars always win.
try {
  const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const key = t.slice(0, i).trim();
    const value = t
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {
  // no .env file — fine in production
}

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export function envOpt(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function envDefault(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

/** Exact sender address of Informed Delivery digests, verified after fetch.
 * Distinct from DIGEST_FROM (the loose JMAP query filter) — this is the
 * exact address a digest must come from to be processed. */
export function digestSenderExact(): string {
  return envDefault("DIGEST_SENDER", "USPSInformedDelivery@email.informeddelivery.usps.com");
}

/** Stable id for this device's push subscription. */
export function deviceClientId(): string {
  return envDefault("DEVICE_CLIENT_ID", "usps-digest-cleaner");
}

/** Keyword that marks a digest as already cleaned. */
export function processedKeyword(): string {
  return envDefault("PROCESSED_KEYWORD", "$usps-processed");
}

/** True when both Cloudflare OCR env vars are present. */
export function cloudflareConfigured(): boolean {
  return Boolean(envOpt("CLOUDFLARE_ACCOUNT_ID") && envOpt("CLOUDFLARE_API_TOKEN"));
}
