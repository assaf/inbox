import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { makeRes } from "./helpers.js";

vi.mock("../lib/subscription.js", () => ({ ensureSubscription: vi.fn() }));
vi.mock("../lib/process.js", () => ({ processNewDigests: vi.fn() }));

import handler from "../api/cron.js";
import { ensureSubscription } from "../lib/subscription.js";
import { processNewDigests } from "../lib/process.js";

const ensureSubscriptionMock = vi.mocked(ensureSubscription);
const processNewDigestsMock = vi.mocked(processNewDigests);

function req(auth?: string): VercelRequest {
  return {
    method: "GET",
    headers: auth ? { authorization: auth } : {},
  } as unknown as VercelRequest;
}

beforeEach(() => {
  ensureSubscriptionMock.mockReset();
  ensureSubscriptionMock.mockResolvedValue("sub-live");
  processNewDigestsMock.mockReset();
  processNewDigestsMock.mockResolvedValue({ processed: 2, failed: 0 });
  process.env.CRON_SECRET = "";
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("/api/cron", () => {
  it("renews the subscription and drains the backlog when no secret is set", async () => {
    const res = makeRes();
    await handler(req(), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, subscriptionId: "sub-live", processed: 2, failed: 0 });
    expect(ensureSubscriptionMock).toHaveBeenCalledTimes(1);
    expect(processNewDigestsMock).toHaveBeenCalledTimes(1);
    expect(processNewDigestsMock).toHaveBeenCalledWith();
  });

  it("rejects a wrong bearer token", async () => {
    process.env.CRON_SECRET = "sekrit";
    const res = makeRes();
    await handler(req("Bearer wrong"), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(401);
    expect(ensureSubscriptionMock).not.toHaveBeenCalled();
    expect(processNewDigestsMock).not.toHaveBeenCalled();
  });

  it("accepts the right bearer token", async () => {
    process.env.CRON_SECRET = "sekrit";
    const res = makeRes();
    await handler(req("Bearer sekrit"), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, subscriptionId: "sub-live", processed: 2, failed: 0 });
  });

  it("returns 500 when subscription renewal fails", async () => {
    ensureSubscriptionMock.mockRejectedValue(new Error("jmap down"));
    const res = makeRes();
    await handler(req(), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "cron failed" });
  });
});
