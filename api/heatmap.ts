import type { VercelRequest, VercelResponse } from "@vercel/node";
import { renderHeatmapPng } from "../lib/heatmap.js";

const CACHE_SECONDS = 4 * 60 * 60;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).end();
    return;
  }
  try {
    const png = await renderHeatmapPng();
    res.setHeader("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
    res.setHeader("Content-Type", "image/png");
    res.status(200).send(png);
  } catch (error) {
    res.status(502).send(`GitHub heatmap needs ${String(error).slice(0, 200)}.`);
  }
}
