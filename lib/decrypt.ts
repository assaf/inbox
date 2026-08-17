import { decrypt as eceDecrypt } from "http_ece";
import { ecdhFromPrivate } from "./keys.js";

export interface PushPayload {
  "@type": string;
  [key: string]: unknown;
}

/**
 * Decrypt an RFC 8291 (aes128gcm) Web Push body from Fastmail.
 * Decryption success is itself authentication: only a sender holding our
 * public key can produce a decryptable payload.
 */
export function decryptPushBody(
  ciphertext: Buffer,
  privateKey: string,
  authSecret: string,
): PushPayload {
  const ecdh = ecdhFromPrivate(privateKey);
  const plain = eceDecrypt(ciphertext, {
    version: "aes128gcm",
    privateKey: ecdh,
    authSecret,
  });
  return JSON.parse(plain.toString("utf8")) as PushPayload;
}
