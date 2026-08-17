type Level = "info" | "warn" | "error";

/**
 * Minimal structured logger: one JSON object per line, so Vercel's log
 * filtering can match `"level":"error"` or a field value. The message is
 * the event name; put variables in `fields`, never in the message string.
 */
function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>): void => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>): void => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>): void => emit("error", msg, fields),
};
