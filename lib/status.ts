import { cloudflareConfigured, deviceClientId } from "./config.js";
import { listMailboxes, listSubscriptions } from "./jmap.js";
import { log } from "./log.js";

export interface ServiceStatus {
  jmapOk: boolean;
  jmapDetail: string;
  pushOk: boolean;
  pushDetail: string;
  ocrOk: boolean;
}

/**
 * The three health checks shared by the status page (/api/index) and the
 * smoke endpoint (/api/smoke): JMAP reachability, a live push subscription
 * for this device, and Cloudflare OCR configuration.
 */
export async function collectStatus(): Promise<ServiceStatus> {
  let jmapOk = false;
  let jmapDetail = "unreachable";
  try {
    const boxes = await listMailboxes();
    jmapOk = boxes.length > 0;
    jmapDetail = `${boxes.length} mailboxes`;
  } catch (err) {
    log.error("status jmap check failed", { err: String(err) });
    jmapDetail = String(err);
  }

  let pushOk = false;
  let pushDetail = "none — run `pnpm setup`";
  try {
    const subs = (await listSubscriptions()).filter((s) => s.deviceClientId === deviceClientId());
    if (subs.length > 0) {
      const s = subs[0]!;
      const exp = s.expires ? new Date(s.expires).toLocaleString() : "no expiry";
      pushDetail = `id ${s.id} · expires ${exp}`;
      pushOk = true;
    }
  } catch (err) {
    log.error("status subscription check failed", { err: String(err) });
    pushDetail = String(err);
  }

  return {
    jmapOk,
    jmapDetail,
    pushOk,
    pushDetail,
    ocrOk: cloudflareConfigured(),
  };
}
