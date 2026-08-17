import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ServiceStatus } from "../lib/status.js";
import { makeRes } from "./helpers.js";

vi.mock("../lib/status.js", () => ({ collectStatus: vi.fn() }));
vi.mock("../lib/jmap.js", () => ({
  unprocessedDigestIds: vi.fn(),
  recentProcessed: vi.fn(),
}));

import handler from "../api/index.js";
import { collectStatus } from "../lib/status.js";
import { unprocessedDigestIds, recentProcessed } from "../lib/jmap.js";

const collectStatusMock = vi.mocked(collectStatus);
const unprocessedDigestIdsMock = vi.mocked(unprocessedDigestIds);
const recentProcessedMock = vi.mocked(recentProcessed);

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

function req(method: string): VercelRequest {
  return { method } as unknown as VercelRequest;
}

beforeEach(() => {
  collectStatusMock.mockReset();
  unprocessedDigestIdsMock.mockReset();
  recentProcessedMock.mockReset();
  unprocessedDigestIdsMock.mockResolvedValue([]);
  recentProcessedMock.mockResolvedValue([]);
});

describe("/api/index", () => {
  it("rejects non-GET", async () => {
    const res = makeRes();
    await handler(req("POST"), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(405);
  });

  it("renders the status page", async () => {
    collectStatusMock.mockResolvedValue(status());
    const res = makeRes();
    await handler(req("GET"), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(200);
    const body = String(res.body);
    expect(body).toContain("<title>inbox — USPS digest cleaner</title>");
    expect(body).toContain(">JMAP</td>");
    expect(body).toContain(">Push subscription</td>");
    expect(body).toContain('aria-label="ok"');
    expect(body).toContain("3 mailboxes");
  });

  it("escapes details and marks failing checks as problems", async () => {
    collectStatusMock.mockResolvedValue(
      status({ jmapOk: false, jmapDetail: '<script>alert("x")</script>' }),
    );
    const res = makeRes();
    await handler(req("GET"), res as unknown as VercelResponse);

    const body = String(res.body);
    expect(body).toContain('aria-label="problem"');
    expect(body).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(body).not.toContain('<script>alert("x")</script>');
  });

  it("lists recently cleaned digests", async () => {
    collectStatusMock.mockResolvedValue(status());
    unprocessedDigestIdsMock.mockResolvedValue(["d1"]);
    recentProcessedMock.mockResolvedValue([
      { receivedAt: "2026-01-02T10:00:00Z", subject: "Daily Digest" },
    ]);
    const res = makeRes();
    await handler(req("GET"), res as unknown as VercelResponse);

    expect(String(res.body)).toContain("2026-01-02 — Daily Digest");
  });
});
