import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatePushKeys, p256dhFromPrivate } from "../lib/keys.js";
import { ensureSubscription, pushUrl } from "../lib/subscription.js";
import type { PushSubscription } from "../lib/jmap.js";

vi.mock("../lib/jmap.js", () => ({
  listSubscriptions: vi.fn(),
  createSubscription: vi.fn(),
  destroySubscription: vi.fn(),
}));

import { listSubscriptions, createSubscription, destroySubscription } from "../lib/jmap.js";

const listSubscriptionsMock = vi.mocked(listSubscriptions);
const createSubscriptionMock = vi.mocked(createSubscription);
const destroySubscriptionMock = vi.mocked(destroySubscription);

// subscription.ts logs on destroy/create; keep test output clean.
vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "info").mockImplementation(() => {});

const DAY = 24 * 60 * 60 * 1000;

function makeSub(overrides: Partial<PushSubscription> & { id: string }): PushSubscription {
  return {
    deviceClientId: "test-device",
    expires: new Date(Date.now() + 20 * DAY).toISOString(),
    url: "https://inbox.labnotes.org/api/push",
    verificationCode: "abc123",
    ...overrides,
  };
}

beforeEach(() => {
  const keys = generatePushKeys();
  process.env.PUBLIC_URL = "https://inbox.labnotes.org";
  process.env.DEVICE_CLIENT_ID = "test-device";
  process.env.PUSH_PRIVATE_KEY = keys.privateKey;
  process.env.PUSH_AUTH = keys.auth;

  listSubscriptionsMock.mockReset();
  createSubscriptionMock.mockReset();
  destroySubscriptionMock.mockReset();
});

describe("ensureSubscription", () => {
  it("creates a subscription when none exist", async () => {
    listSubscriptionsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    createSubscriptionMock.mockResolvedValue("sub-new");

    await expect(ensureSubscription()).resolves.toBe("sub-new");

    expect(destroySubscriptionMock).not.toHaveBeenCalled();
    expect(createSubscriptionMock).toHaveBeenCalledTimes(1);
    expect(createSubscriptionMock).toHaveBeenCalledWith({
      url: "https://inbox.labnotes.org/api/push",
      p256dh: p256dhFromPrivate(process.env.PUSH_PRIVATE_KEY!),
      auth: process.env.PUSH_AUTH,
      deviceClientId: "test-device",
      expires: expect.any(String),
    });
  });

  it("keeps a live, verified subscription untouched", async () => {
    const live = makeSub({ id: "sub1" });
    listSubscriptionsMock.mockResolvedValueOnce([live]).mockResolvedValueOnce([live]);

    await expect(ensureSubscription()).resolves.toBe("sub1");

    expect(destroySubscriptionMock).not.toHaveBeenCalled();
    expect(createSubscriptionMock).not.toHaveBeenCalled();
  });

  it("destroys and recreates an expiring subscription", async () => {
    const expiring = makeSub({ id: "sub1", expires: new Date(Date.now() + 3 * DAY).toISOString() });
    listSubscriptionsMock.mockResolvedValueOnce([expiring]).mockResolvedValueOnce([]);
    destroySubscriptionMock.mockResolvedValue(undefined);
    createSubscriptionMock.mockResolvedValue("sub-new");

    await expect(ensureSubscription()).resolves.toBe("sub-new");

    expect(destroySubscriptionMock).toHaveBeenCalledWith("sub1");
    expect(createSubscriptionMock).toHaveBeenCalledTimes(1);
  });

  it("destroys and recreates an unverified subscription (self-healing)", async () => {
    const unverified = makeSub({ id: "sub1", verificationCode: null });
    listSubscriptionsMock.mockResolvedValueOnce([unverified]).mockResolvedValueOnce([]);
    destroySubscriptionMock.mockResolvedValue(undefined);
    createSubscriptionMock.mockResolvedValue("sub-new");

    await expect(ensureSubscription()).resolves.toBe("sub-new");

    expect(destroySubscriptionMock).toHaveBeenCalledWith("sub1");
    expect(createSubscriptionMock).toHaveBeenCalledTimes(1);
  });

  it("ignores subscriptions for other deviceClientIds", async () => {
    const other = makeSub({ id: "sub-other", deviceClientId: "someone-else" });
    listSubscriptionsMock.mockResolvedValueOnce([other]).mockResolvedValueOnce([other]);
    createSubscriptionMock.mockResolvedValue("sub-new");

    await expect(ensureSubscription()).resolves.toBe("sub-new");

    expect(destroySubscriptionMock).not.toHaveBeenCalled();
    expect(createSubscriptionMock).toHaveBeenCalledTimes(1);
  });
});

describe("pushUrl", () => {
  it("strips trailing slashes", () => {
    process.env.PUBLIC_URL = "https://inbox.labnotes.org/";
    expect(pushUrl()).toBe("https://inbox.labnotes.org/api/push");
  });
});
