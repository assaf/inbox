import { describe, it, expect } from "vitest";
import { createECDH } from "node:crypto";
import { encrypt } from "http_ece";
import { generatePushKeys, p256dhFromPrivate } from "../lib/keys.js";
import { decryptPushBody } from "../lib/decrypt.js";

describe("decryptPushBody", () => {
  it("round-trips an RFC 8291 aes128gcm payload", () => {
    const keys = generatePushKeys();
    const sender = createECDH("prime256v1");
    sender.generateKeys();

    const payload = {
      "@type": "PushVerification",
      pushSubscriptionId: "42",
      verificationCode: "abc123",
    };
    const ciphertext = encrypt(Buffer.from(JSON.stringify(payload), "utf8"), {
      version: "aes128gcm",
      dh: p256dhFromPrivate(keys.privateKey),
      privateKey: sender,
      authSecret: keys.auth,
    });

    expect(decryptPushBody(ciphertext, keys.privateKey, keys.auth)).toEqual(payload);
  });

  it("rejects a payload encrypted to a different key", () => {
    const ours = generatePushKeys();
    const theirs = generatePushKeys();
    const sender = createECDH("prime256v1");
    sender.generateKeys();

    const ciphertext = encrypt(Buffer.from('{"@type":"StateChange"}', "utf8"), {
      version: "aes128gcm",
      dh: p256dhFromPrivate(theirs.privateKey),
      privateKey: sender,
      authSecret: theirs.auth,
    });

    expect(() => decryptPushBody(ciphertext, ours.privateKey, ours.auth)).toThrow();
  });
});
