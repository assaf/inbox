/** Standard `Authorization: Bearer <token>` header for Cloudflare / JMAP calls. */
export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Upper bound on any upstream request; keeps serverless invocations from
 * burning their whole maxDuration on a hung connection. */
export const REQUEST_TIMEOUT_MS = 30_000;
