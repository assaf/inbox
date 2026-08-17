import { describe, it, expect } from "vitest";
import { generatePushKeys, p256dhFromPrivate, ecdhFromPrivate, b64url } from "../lib/keys.js";

describe("keys", () => {
  it("generates URL-safe base64 keys", () => {
    const keys = generatePushKeys();
    expect(keys.privateKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(keys.auth).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(keys.p256dh).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("p256dh is the uncompressed P-256 point (65 bytes = 87 base64url chars)", () => {
    const keys = generatePushKeys();
    expect(keys.p256dh).toHaveLength(87);
    expect(Buffer.from(keys.p256dh, "base64url")).toHaveLength(65);
    expect(Buffer.from(keys.p256dh, "base64url")[0]).toBe(0x04);
  });

  it("auth secret is 16 random bytes", () => {
    expect(Buffer.from(generatePushKeys().auth, "base64url")).toHaveLength(16);
  });

  it("derives the public point from the private key deterministically", () => {
    const keys = generatePushKeys();
    expect(p256dhFromPrivate(keys.privateKey)).toBe(keys.p256dh);
  });

  it("ecdhFromPrivate exposes the same public key", () => {
    const keys = generatePushKeys();
    const ecdh = ecdhFromPrivate(keys.privateKey);
    expect(ecdh.getPublicKey(undefined, "uncompressed")).toEqual(
      Buffer.from(keys.p256dh, "base64url"),
    );
  });

  it("b64url strips padding", () => {
    expect(b64url(Buffer.alloc(16))).not.toContain("=");
  });
});
