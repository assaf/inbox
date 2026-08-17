import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../lib/config.js";
import { generatePushKeys } from "../lib/keys.js";
import { ensureSubscription, pushUrl } from "../lib/subscription.js";

function upsertEnv(path: string, updates: Record<string, string>): void {
  let content = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = content.split("\n");
  for (const [key, value] of Object.entries(updates)) {
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    const line = `${key}=${value}`;
    if (idx === -1) lines.push(line);
    else lines[idx] = line;
  }
  writeFileSync(path, `${lines.join("\n").replace(/^\n+/, "")}\n`);
}

async function main(): Promise<void> {
  const envPath = resolve(process.cwd(), ".env");

  if (!process.env.PUSH_PRIVATE_KEY || !process.env.PUSH_AUTH) {
    const keys = generatePushKeys();
    process.env.PUSH_PRIVATE_KEY = keys.privateKey;
    process.env.PUSH_AUTH = keys.auth;
    upsertEnv(envPath, {
      PUSH_PRIVATE_KEY: keys.privateKey,
      PUSH_AUTH: keys.auth,
    });
    console.info("Generated push keys. Add them to Vercel (production):");
    console.info(`  vercel env add PUSH_PRIVATE_KEY ${keys.privateKey}`);
    console.info(`  vercel env add PUSH_AUTH ${keys.auth}`);
  }

  const id = await ensureSubscription();
  console.info(`Subscription active: ${id}`);
  console.info(`Pushes + verification arrive at ${pushUrl()}`);
  console.info(
    "If this is the first run, deploy first so the verification webhook is live," +
      ` then run this again. Token: ${env("FASTMAIL_TOKEN") ? "set" : "MISSING"}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
