import { env, envDefault, processedKeyword } from "./config.js";
import { bearer, REQUEST_TIMEOUT_MS } from "./http.js";

const SESSION_URL = "https://api.fastmail.com/jmap/session";

interface Session {
  apiUrl: string;
  uploadUrl: string;
  downloadUrl: string;
  accountId: string;
  username: string;
}

interface SessionResponse {
  apiUrl: string;
  uploadUrl: string;
  downloadUrl: string;
  username: string;
  primaryAccounts: Record<string, string>;
}

let sessionCache: Session | null = null;
let sessionPromise: Promise<Session> | null = null;

export async function session(): Promise<Session> {
  if (sessionCache) return sessionCache;
  sessionPromise ??= (async () => {
    const res = await fetch(SESSION_URL, {
      headers: bearer(env("FASTMAIL_TOKEN")),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`JMAP session failed: ${res.status} ${await res.text()}`);
    }
    const j = (await res.json()) as SessionResponse;
    const accountId = j.primaryAccounts["urn:ietf:params:jmap:mail"];
    if (!accountId) throw new Error("JMAP session missing mail account");
    sessionCache = {
      apiUrl: j.apiUrl,
      uploadUrl: j.uploadUrl,
      downloadUrl: j.downloadUrl,
      accountId,
      username: j.username,
    };
    return sessionCache;
  })();
  return sessionPromise;
}

interface ApiResponse {
  methodResponses: [string, unknown, string][];
}

/** POST a batch of method calls; throws on the first per-call error. */
export async function api(methodCalls: unknown[][]): Promise<[string, unknown, string][]> {
  const s = await session();
  const res = await fetch(s.apiUrl, {
    method: "POST",
    headers: {
      ...bearer(env("FASTMAIL_TOKEN")),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`JMAP API failed: ${res.status} ${await res.text()}`);
  }
  const j = (await res.json()) as ApiResponse;
  for (const [name, args] of j.methodResponses) {
    if (name === "error") throw new Error(`JMAP ${name} error: ${JSON.stringify(args)}`);
    // A /set or /import call can "succeed" while individual objects fail with
    // notUpdated/notCreated/notDestroyed. Fastmail reports invalid keyword
    // paths this way, and it silently hid a re-import loop — surface it.
    const a = args as {
      notUpdated?: Record<string, unknown>;
      notCreated?: Record<string, unknown>;
      notDestroyed?: Record<string, unknown>;
    };
    for (const key of ["notUpdated", "notCreated", "notDestroyed"] as const) {
      const failures = a[key];
      if (failures && Object.keys(failures).length > 0) {
        throw new Error(`JMAP ${name} ${key}: ${JSON.stringify(failures)}`);
      }
    }
  }
  return j.methodResponses;
}

/** Unwrap the args of the first method response. */
function firstArgs(responses: [string, unknown, string][]): unknown {
  const first = responses[0];
  if (!first) throw new Error("JMAP returned no method responses");
  return first[1];
}

/**
 * POST one method call and unwrap its response args. Each call site declares
 * the expected `Result` shape, so the single cast here is checked at the
 * call site wherever the result is used.
 */
async function call<Args, Result>(name: string, args: Args): Promise<Result> {
  return firstArgs(await api([[name, args, "m0"]])) as Result;
}

export interface Mailbox {
  id: string;
  role?: string | null;
}

export async function listMailboxes(): Promise<Mailbox[]> {
  const s = await session();
  const { list } = await call<{ accountId: string; ids: null }, { list: Mailbox[] }>(
    "Mailbox/get",
    { accountId: s.accountId, ids: null },
  );
  return list;
}

async function mailboxIdByRole(role: string): Promise<string> {
  const boxes = await listMailboxes();
  const box = boxes.find((b) => b.role === role);
  if (!box) throw new Error(`No ${role} mailbox found`);
  return box.id;
}

export async function inboxId(): Promise<string> {
  return mailboxIdByRole("inbox");
}

export interface RawEmail {
  id: string;
  raw: Buffer;
  receivedAt: string;
  subject: string;
  /** Sender address from the From header (first entry, or null). */
  from: string | null;
}

/** Fetch the full RFC 5322 source of an email by downloading its blob. */
export async function rawEmail(id: string): Promise<RawEmail> {
  const s = await session();
  const { list } = await call<
    { accountId: string; ids: string[]; properties: string[] },
    { list: Array<Record<string, unknown>> }
  >("Email/get", {
    accountId: s.accountId,
    ids: [id],
    properties: ["receivedAt", "subject", "blobId", "from"],
  });
  const email = list[0];
  if (!email) throw new Error(`Email ${id} not found`);

  const blobId = email["blobId"] as string;
  // The top-level Email blob is the full RFC 5322 message; Fastmail serves it
  // for both message/rfc822 and application/octet-stream.
  const url = s.downloadUrl
    .replace("{accountId}", s.accountId)
    .replace("{blobId}", blobId)
    .replace("{name}", "email.eml")
    .replace("{type}", "message/rfc822");

  const res = await fetch(url, {
    headers: bearer(env("FASTMAIL_TOKEN")),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`email download failed: ${res.status} ${await res.text()}`);
  }
  const raw = Buffer.from(await res.arrayBuffer());
  const fromList = email["from"] as Array<{ email?: string }> | null | undefined;
  return {
    id,
    raw,
    receivedAt: (email["receivedAt"] as string) ?? new Date().toISOString(),
    subject: (email["subject"] as string) ?? "",
    from: fromList?.[0]?.email ?? null,
  };
}

/** Query digests that have not been cleaned yet. */
export async function unprocessedDigestIds(): Promise<string[]> {
  const s = await session();
  const { ids } = await call<
    {
      accountId: string;
      filter: { from: string; subject: string; notKeyword: string };
      sort: Array<{ property: string; isAscending: boolean }>;
      limit: number;
    },
    { ids: string[] }
  >("Email/query", {
    accountId: s.accountId,
    filter: {
      from: envDefault("DIGEST_FROM", "informeddelivery"),
      subject: envDefault("DIGEST_SUBJECT", "Daily Digest"),
      notKeyword: processedKeyword(),
    },
    sort: [{ property: "receivedAt", isAscending: true }],
    limit: 10,
  });
  return ids;
}

/** Import a raw RFC 5322 message into the Inbox. Returns the new email id. */
export async function importEmail(raw: Buffer, receivedAt: string): Promise<string> {
  const s = await session();
  const token = env("FASTMAIL_TOKEN");

  const uploadUrl = s.uploadUrl.replace("{accountId}", s.accountId);
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      ...bearer(token),
      "Content-Type": "message/rfc822",
    },
    body: new Uint8Array(raw),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!up.ok) throw new Error(`upload failed: ${up.status} ${await up.text()}`);
  const upj = (await up.json()) as { blobId: string };
  if (!upj.blobId) throw new Error("upload missing blobId");

  const inbox = await inboxId();
  const { created } = await call<
    {
      accountId: string;
      emails: Record<string, unknown>;
    },
    { created: Record<string, { id: string } | null> }
  >("Email/import", {
    accountId: s.accountId,
    emails: {
      e1: {
        blobId: upj.blobId,
        mailboxIds: { [inbox]: true },
        // Mark the clean copy processed so it can never match the digest
        // query and trigger a re-import loop.
        keywords: { [processedKeyword()]: true },
        receivedAt,
      },
    },
  });
  const createdEmail = created["e1"];
  if (!createdEmail) throw new Error("import did not create an email");
  return createdEmail.id;
}

/** Move an email out of the Inbox into Trash. */
export async function trashEmail(id: string): Promise<void> {
  const s = await session();
  const trash = await mailboxIdByRole("trash");
  await call<{ accountId: string; update: Record<string, unknown> }, unknown>("Email/set", {
    accountId: s.accountId,
    update: {
      [id]: {
        // Fastmail treats mailboxIds as a full replacement and rejects
        // `false` values: setting only the Trash mailbox moves the email
        // there and removes it from the Inbox.
        mailboxIds: { [trash]: true },
      },
    },
  });
}

/** Mark the original digest read + processed (both keyword flags). */
export async function markProcessed(id: string): Promise<void> {
  const s = await session();
  await call<{ accountId: string; update: Record<string, unknown> }, unknown>("Email/set", {
    accountId: s.accountId,
    update: {
      [id]: {
        [`keywords/${processedKeyword()}`]: true,
        // Fastmail rejects RFC-style `\seen`; its seen keyword is `$seen`.
        "keywords/$seen": true,
      },
    },
  });
}

export interface PushSubscription {
  id: string;
  deviceClientId: string;
  expires: string | null;
  url: string;
}

export async function listSubscriptions(): Promise<PushSubscription[]> {
  const { list } = await call<Record<string, never>, { list: PushSubscription[] }>(
    "PushSubscription/get",
    {},
  );
  return list;
}

export async function createSubscription(opts: {
  url: string;
  p256dh: string;
  auth: string;
  deviceClientId: string;
  expires: string;
}): Promise<string> {
  const { created } = await call<
    { create: Record<string, unknown> },
    { created: Record<string, { id: string }> }
  >("PushSubscription/set", {
    create: {
      sub1: {
        deviceClientId: opts.deviceClientId,
        url: opts.url,
        types: ["Email"],
        keys: { p256dh: opts.p256dh, auth: opts.auth },
        expires: opts.expires,
      },
    },
  });
  return created["sub1"]?.id ?? "";
}

export async function setVerificationCode(id: string, code: string): Promise<void> {
  await call<{ update: Record<string, unknown> }, unknown>("PushSubscription/set", {
    update: { [id]: { verificationCode: code } },
  });
}

export async function destroySubscription(id: string): Promise<void> {
  await call<{ destroy: string[] }, unknown>("PushSubscription/set", { destroy: [id] });
}

export interface RecentEmail {
  receivedAt: string;
  subject: string;
}

/** The most recently cleaned digests, newest first — for the status page. */
export async function recentProcessed(limit = 5): Promise<RecentEmail[]> {
  const s = await session();
  const { ids } = await call<
    {
      accountId: string;
      filter: { hasKeyword: string };
      sort: Array<{ property: string; isAscending: boolean }>;
      limit: number;
    },
    { ids: string[] }
  >("Email/query", {
    accountId: s.accountId,
    filter: { hasKeyword: processedKeyword() },
    sort: [{ property: "receivedAt", isAscending: false }],
    limit,
  });
  if (ids.length === 0) return [];

  const { list } = await call<
    { accountId: string; ids: string[]; properties: string[] },
    { list: Array<{ subject?: string; receivedAt?: string }> }
  >("Email/get", {
    accountId: s.accountId,
    ids,
    properties: ["subject", "receivedAt"],
  });
  return list.map((e) => ({ subject: e.subject ?? "", receivedAt: e.receivedAt ?? "" }));
}
