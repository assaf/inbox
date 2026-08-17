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
