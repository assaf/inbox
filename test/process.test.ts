import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Digest } from "../lib/digest.js";
import { processNewDigests } from "../lib/process.js";

vi.mock("../lib/jmap.js", () => ({
  session: vi.fn(),
  unprocessedDigestIds: vi.fn(),
  rawEmail: vi.fn(),
  importEmail: vi.fn(),
  markProcessed: vi.fn(),
}));

vi.mock("../lib/clean.js", () => ({
  rebuildDigest: vi.fn(),
}));

import {
  session,
  unprocessedDigestIds,
  rawEmail,
  importEmail,
  markProcessed,
} from "../lib/jmap.js";
import { rebuildDigest } from "../lib/clean.js";

const sessionMock = vi.mocked(session);
const unprocessedDigestIdsMock = vi.mocked(unprocessedDigestIds);
const rawEmailMock = vi.mocked(rawEmail);
const importEmailMock = vi.mocked(importEmail);
const markProcessedMock = vi.mocked(markProcessed);
const rebuildDigestMock = vi.mocked(rebuildDigest);

const SESSION = {
  apiUrl: "https://api.fastmail.com/jmap/api",
  uploadUrl: "https://api.fastmail.com/jmap/upload/{accountId}/",
  downloadUrl: "https://api.fastmail.com/jmap/download/{accountId}/{blobId}/{name}?type={type}",
  accountId: "u1",
  username: "assaf@labnotes.org",
};

const digest = { scans: [], droppedAds: [], packages: [] } as unknown as Digest;

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  sessionMock.mockReset();
  unprocessedDigestIdsMock.mockReset();
  rawEmailMock.mockReset();
  importEmailMock.mockReset();
  markProcessedMock.mockReset();
  rebuildDigestMock.mockReset();
});

describe("processNewDigests", () => {
  it("marks processed before importing", async () => {
    unprocessedDigestIdsMock.mockResolvedValue(["id1"]);
    sessionMock.mockResolvedValue(SESSION);
    rawEmailMock.mockResolvedValue({
      id: "id1",
      raw: Buffer.from("raw"),
      receivedAt: "2026-01-01T00:00:00Z",
      subject: "Daily Digest",
    });
    rebuildDigestMock.mockResolvedValue({ digest, clean: Buffer.from("clean") });
    importEmailMock.mockResolvedValue("new1");

    await processNewDigests();

    expect(markProcessedMock).toHaveBeenCalledWith("id1");
    expect(importEmailMock).toHaveBeenCalledWith(Buffer.from("clean"), "2026-01-01T00:00:00Z");
    expect(markProcessedMock.mock.invocationCallOrder[0]!).toBeLessThan(
      importEmailMock.mock.invocationCallOrder[0]!,
    );
  });

  it("respects the limit", async () => {
    unprocessedDigestIdsMock.mockResolvedValue(["a", "b", "c"]);
    sessionMock.mockResolvedValue(SESSION);
    rawEmailMock.mockResolvedValue({
      id: "a",
      raw: Buffer.from("raw"),
      receivedAt: "2026-01-01T00:00:00Z",
      subject: "Daily Digest",
    });
    rebuildDigestMock.mockResolvedValue({ digest, clean: Buffer.from("clean") });
    importEmailMock.mockResolvedValue("new1");

    await processNewDigests(1);

    expect(rawEmailMock).toHaveBeenCalledTimes(1);
    expect(importEmailMock).toHaveBeenCalledTimes(1);
  });

  it("stays marked when import fails (no rollback possible)", async () => {
    unprocessedDigestIdsMock.mockResolvedValue(["id1"]);
    sessionMock.mockResolvedValue(SESSION);
    rawEmailMock.mockResolvedValue({
      id: "id1",
      raw: Buffer.from("raw"),
      receivedAt: "2026-01-01T00:00:00Z",
      subject: "Daily Digest",
    });
    rebuildDigestMock.mockResolvedValue({ digest, clean: Buffer.from("clean") });
    importEmailMock.mockRejectedValue(new Error("boom"));

    const result = await processNewDigests();

    expect(markProcessedMock).toHaveBeenCalledWith("id1");
    expect(result).toEqual({ processed: 0, failed: 1 });
  });
});
