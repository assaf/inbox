import { spawn } from "node:child_process";

/**
 * Runs `vercel dev` on the port Portless assigns (PORT env). The dev script
 * points here instead of directly at `vercel dev`, because Vercel's CLI
 * refuses to run when `package.json#scripts.dev` itself contains "vercel dev".
 */
const port = process.env.PORT ?? "3000";
const child = spawn("vercel", ["dev", "--listen", `127.0.0.1:${port}`], {
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  console.error("[dev] failed to start vercel dev:", err);
  process.exit(1);
});
