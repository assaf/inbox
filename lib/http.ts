/** Standard `Authorization: Bearer <token>` header for Cloudflare / JMAP calls. */
export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
