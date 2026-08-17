import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { makeRes } from "./helpers.js";

vi.mock("../lib/decrypt.js", () => ({ decryptPushBody: vi.fn() }));
vi.mock("../lib/jmap.js", () => ({ setVerificationCode: vi.fn() }));
vi.mock("../lib/process.js", () => ({ processNewDigests: vi.fn() }));

import handler from "../api/push.js";
import { decryptPushBody } from "../lib/decrypt.js";
import { setVerificationCode } from "../lib/jmap.js";
import { processNewDigests } from "../lib/process.js";

const decryptPushBodyMock = vi.mocked(decryptPushBody);
const setVerificationCodeMock = vi.mocked(setVerificationCode);
const processNewDigestsMock = vi.mocked(processNewDigests);

function req(method: string, body: Buffer): VercelRequest {
  return { method, body } as unknown as VercelRequest;
}

beforeEach(() => {
  decryptPushBodyMock.mockReset();
  setVerificationCodeMock.mockReset();
  processNewDigestsMock.mockReset();
  processNewDigestsMock.mockResolvedValue({ processed: 1, failed: 0 });
  process.env.PUSH_PRIVATE_KEY = "private";
  process.env.PUSH_AUTH = "auth";
});

describe("/api/push", () => {
  it("rejects non-POST", async () => {
    const res = makeRes();
    await handler(req("GET", Buffer.from("x")), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(405);
    expect(decryptPushBodyMock).not.toHaveBeenCalled();
  });

  it("rejects a body that fails decryption", async () => {
    decryptPushBodyMock.mockImplementation(() => {
      throw new Error("bad key");
    });
    const res = makeRes();
    await handler(req("POST", Buffer.from("noise")), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "decrypt failed" });
  });

  it("rejects an oversized body", async () => {
    const res = makeRes();
    await handler(req("POST", Buffer.alloc(1024 * 1024 + 1)), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "decrypt failed" });
  });

  it("completes a PushVerification", async () => {
    decryptPushBodyMock.mockImplementation(() => ({
      "@type": "PushVerification",
      pushSubscriptionId: "sub1",
      verificationCode: "123456",
    }));
    const res = makeRes();
    await handler(req("POST", Buffer.from("enc")), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(200);
    expect(setVerificationCodeMock).toHaveBeenCalledWith("sub1", "123456");
  });

  it("returns 500 when the verification update fails", async () => {
    decryptPushBodyMock.mockImplementation(() => ({
      "@type": "PushVerification",
      pushSubscriptionId: "sub1",
      verificationCode: "123456",
    }));
    setVerificationCodeMock.mockRejectedValue(new Error("jmap down"));
    const res = makeRes();
    await handler(req("POST", Buffer.from("enc")), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "verification failed" });
  });

  it("processes one digest on StateChange", async () => {
    decryptPushBodyMock.mockImplementation(() => ({ "@type": "StateChange" }));
    const res = makeRes();
    await handler(req("POST", Buffer.from("enc")), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(200);
    expect(processNewDigestsMock).toHaveBeenCalledWith(1);
  });

  it("acknowledges unknown payload types without processing", async () => {
    decryptPushBodyMock.mockImplementation(() => ({ "@type": "SomethingElse" }));
    const res = makeRes();
    await handler(req("POST", Buffer.from("enc")), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(200);
    expect(processNewDigestsMock).not.toHaveBeenCalled();
  });
});
