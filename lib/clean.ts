import { digestSenderExact } from "./config.js";
import { parseDigest, buildCleanMessage, type Digest } from "./digest.js";
import { enrichSenders } from "./sender.js";

export interface CleanedDigest {
  digest: Digest;
  clean: Buffer;
}

/** Parse a raw digest, OCR any missing senders, and rebuild the clean message. */
export async function rebuildDigest(raw: Buffer, username: string): Promise<CleanedDigest> {
  const digest = await parseDigest(raw);
  await enrichSenders(digest);
  const clean = await buildCleanMessage(digest, {
    from: digest.from ?? digestSenderExact(),
    to: username,
  });
  return { digest, clean };
}
