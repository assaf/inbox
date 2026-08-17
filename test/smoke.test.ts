import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ServiceStatus } from "../lib/status.js";
import { makeRes } from "./helpers.js";

vi.mock("../lib/status.js", () => ({ collectStatus: vi.fn() }));

import handler from "../api/smoke.js";
import { collectStatus } from "../lib/status.js";

const collectStatusMock = vi.mocked(collectStatus);

function req(secret?: string): VercelRequest {
  return {
    method: "GET",
    headers: secret ? { "x-smoke-secret": secret } : {},
  } as unknown as VercelRequest;
}

function status(overrides: Partial<ServiceStatus> = {}): ServiceStatus {
  return {
    jmapOk: true,
    jmapDetail: "3 mailboxes",
    pushOk: true,
    pushDetail: "id sub1 · expires never",
    ocrOk: true,
    ...overrides,
  };
}

beforeEach(() => {
  collectStatusMock.mockReset();
  process.env.SMOKE_TEST_SECRET = "";
});

afterEach(() => {
  delete process.env.SMOKE_TEST_SECRET;
});

describe("/api/smoke", () => {
  it("is disabled (404) when no secret is configured", async () => {
    const res = makeRes();
    await handler(req(), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(404);
    expect(collectStatusMock).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret", async () => {
    process.env.SMOKE_TEST_SECRET = "sekrit";
    const res = makeRes();
    await handler(req("wrong"), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(401);
    expect(collectStatusMock).not.toHaveBeenCalled();
  });

  it("reports 200 when every check passes", async () => {
    process.env.SMOKE_TEST_SECRET = "sekrit";
    collectStatusMock.mockResolvedValue(status());
    const res = makeRes();
    await handler(req("sekrit"), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      jmap: true,
      pushSubscription: true,
      cloudflareOcr: true,
    });
  });

  it("reports 500 when a check fails", async () => {
    process.env.SMOKE_TEST_SECRET = "sekrit";
    collectStatusMock.mockResolvedValue(status({ jmapOk: false }));
    const res = makeRes();
    await handler(req("sekrit"), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      ok: false,
      jmap: false,
      pushSubscription: true,
      cloudflareOcr: true,
    });
  });
});
