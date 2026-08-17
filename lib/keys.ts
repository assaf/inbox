import { createECDH, randomBytes, type ECDH } from "node:crypto";

export function b64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export interface PushKeys {
  /** Private P-256 key, URL-safe base64 (no padding). */
  privateKey: string;
  /** 16-byte auth secret, URL-safe base64 (no padding). */
  auth: string;
  /** Uncompressed P-256 public point (65 bytes incl. 0x04), URL-safe base64. */
  p256dh: string;
}

export function generatePushKeys(): PushKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    privateKey: b64url(ecdh.getPrivateKey()),
    auth: b64url(randomBytes(16)),
    p256dh: b64url(ecdh.getPublicKey(undefined, "uncompressed")),
  };
}

/** Derive the public key from a stored private key, so only one value persists. */
export function p256dhFromPrivate(privateKey: string): string {
  const ecdh = ecdhFromPrivate(privateKey);
  return b64url(ecdh.getPublicKey(undefined, "uncompressed"));
}

export function ecdhFromPrivate(privateKey: string): ECDH {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(privateKey, "base64url"));
  return ecdh;
}
