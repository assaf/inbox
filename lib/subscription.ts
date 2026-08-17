import { env, envDefault } from "./config.js";
import { p256dhFromPrivate } from "./keys.js";
import { listSubscriptions, createSubscription, destroySubscription } from "./jmap.js";

const SUBSCRIPTION_LIFETIME_DAYS = 30;
const RENEW_WITHIN_DAYS = 7;

function ms(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

export function pushUrl(): string {
  return `${env("PUBLIC_URL").replace(/\/+$/, "")}/api/push`;
}

/**
 * Make sure a live, verified subscription for our deviceClientId exists.
 *
 * Self-heals two failure modes: an expired (or soon-expiring) subscription, and
 * one that was created but never verified (the PushVerification webhook echo
 * failed). Recreating triggers a fresh verification push to our own webhook.
 */
export async function ensureSubscription(): Promise<string> {
  const deviceId = envDefault("DEVICE_CLIENT_ID", "usps-digest-cleaner");
  const p256dh = p256dhFromPrivate(env("PUSH_PRIVATE_KEY"));
  const auth = env("PUSH_AUTH");

  const subs = await listSubscriptions();
  const ours = subs.filter((s) => s.deviceClientId === deviceId);

  for (const s of ours) {
    const expiring =
      !s.expires || new Date(s.expires).getTime() < Date.now() + ms(RENEW_WITHIN_DAYS);
    if (expiring) {
      console.warn(`[subscription] destroying ${s.id} (expiring)`);
      await destroySubscription(s.id);
    }
  }

  const remaining = (await listSubscriptions()).filter((s) => s.deviceClientId === deviceId);
  const live = remaining.find(
    (s) => s.expires && new Date(s.expires).getTime() >= Date.now() + ms(RENEW_WITHIN_DAYS),
  );
  if (live) return live.id;

  const expires = new Date(Date.now() + ms(SUBSCRIPTION_LIFETIME_DAYS)).toISOString();
  const id = await createSubscription({
    url: pushUrl(),
    p256dh,
    auth,
    deviceClientId: deviceId,
    expires,
  });
  console.info(`[subscription] created ${id} -> ${pushUrl()}`);
  return id;
}
