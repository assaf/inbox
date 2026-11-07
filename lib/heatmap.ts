import { PLEX_SANS_BASE64 } from "./plex-sans-base64.js";
import { RESVG_WASM_BASE64 } from "./resvg-wasm-base64.js";

/**
 * GitHub contribution heatmap (server-side rendering).
 *
 * The data comes from GitHub's GraphQL `contributionsCollection`
 * (`contributionCalendar`), which counts contributions across every
 * repository the token's owner can see — public and private alike — so the
 * grid matches the contribution graph on the owner's GitHub profile.
 *
 * The image is drawn ourselves: GitHub serves its graph as an SVG web
 * component on the profile page and offers no embeddable equivalent, and
 * any third-party proxy would either expose the token or show only public
 * activity. The renderer below mirrors the profile graph's geometry (10px
 * cells, 3px gaps, GitHub's own green palette), the quartile levels GitHub
 * itself reports, month labels, weekday abbreviations, and the "Less /
 * More" legend.
 *
 * Data queries are expensive (GitHub rate-limits the calendar query to a
 * low hourly allowance), so the route caches the rendered PNG for four
 * hours — contributions don't need to be fresher than that.
 */

export interface ContributionDayCell {
  count: number;
  date: string; // YYYY-MM-DD
}

export interface ContributionWeek {
  days: ContributionDayCell[];
}

export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const TOKEN_ENV = "GITHUB_TOKEN";
const LOGIN = "assaf";

const QUERY = `query Heatmap($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}`;

interface CalendarPayload {
  data?: {
    user?: {
      contributionsCollection?: {
        contributionCalendar?: {
          totalContributions?: number;
          weeks?: {
            contributionDays?: {
              contributionCount?: number;
              date?: string;
            }[];
          }[];
        };
      };
    };
  };
}

export async function fetchContributions(): Promise<{
  totalContributions: number;
  weeks: ContributionWeek[];
}> {
  const token = process.env[TOKEN_ENV];
  if (!token) {
    throw new Error(`Missing ${TOKEN_ENV} (GitHub token with "repo" scope).`);
  }
  const response = await fetch(GITHUB_GRAPHQL, {
    body: JSON.stringify({
      query: QUERY,
      variables: {
        from: `${new Date(Date.now() - 365 * 86400000).toISOString()}`,
        login: LOGIN,
        to: `${new Date().toISOString()}`,
      },
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `GitHub GraphQL error ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  const payload = (await response.json()) as CalendarPayload;
  const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) {
    throw new Error("GitHub did not return a contribution calendar.");
  }
  const weeks: ContributionWeek[] = [];
  for (const week of calendar.weeks ?? []) {
    const days: ContributionDayCell[] = [];
    for (const day of week.contributionDays ?? []) {
      if (typeof day.date === "string" && typeof day.contributionCount === "number") {
        days.push({ count: day.contributionCount, date: day.date });
      }
    }
    if (days.length > 0) weeks.push({ days });
  }
  return {
    totalContributions: calendar.totalContributions ?? 0,
    weeks,
  };
}

// ---------------------------------------------------------------------------
// Levels and palette
// ---------------------------------------------------------------------------
//
// GitHub colors cells by the quartile of the day's contribution count among
// the days that have any activity (0 stays empty). Mirrored from the
// `contributionLevel` values the API itself returns.

export function levelsForCounts(counts: number[]): ContributionLevel[] {
  const nonzero = counts.filter((c) => c > 0).sort((a, b) => a - b);
  if (nonzero.length === 0) return counts.map(() => 0);
  const quartile = (q: number): number => {
    const index = Math.floor((q * (nonzero.length - 1)) / 4);
    return nonzero[Math.min(index, nonzero.length - 1)] ?? 0;
  };
  const q1 = quartile(1);
  const q2 = quartile(2);
  const q3 = quartile(3);
  return counts.map((count) => {
    if (count <= 0) return 0;
    if (count <= q1) return 1;
    if (count <= q2) return 2;
    if (count <= q3) return 3;
    return 4;
  });
}

const PALETTE = {
  dark: {
    bg: [13, 17, 23] as const,
    border: [48, 54, 61] as const,
    dot: [110, 119, 129] as const,
    ghost: [48, 54, 61] as const,
    level: [
      [48, 54, 61],
      [10, 68, 38],
      [0, 109, 50],
      [38, 166, 91],
      [57, 240, 140],
    ] as readonly (readonly number[])[],
    text: [230, 237, 243] as const,
  },
  light: {
    bg: [255, 255, 255] as const,
    border: [27, 31, 35] as const,
    dot: [144, 149, 153] as const,
    ghost: [235, 237, 240] as const,
    level: [
      [235, 237, 240],
      [195, 240, 205],
      [155, 233, 168],
      [64, 196, 99],
      [48, 161, 78],
      [33, 102, 47],
    ] as readonly (readonly number[])[],
    text: [31, 35, 40] as const,
  },
} satisfies Record<
  string,
  {
    bg: readonly number[];
    border: readonly number[];
    dot: readonly number[];
    ghost: readonly number[];
    level: readonly (readonly number[])[];
    text: readonly number[];
  }
>;

export interface Theme {
  bg: readonly number[];
  border: readonly number[];
  dot: readonly number[];
  ghost: readonly number[];
  level: readonly (readonly number[])[];
  text: readonly number[];
}

/**
 * GitHub switches the graph's palette with the site theme and detects it
 * server-side for the profile page. This renderer has no header context
 * (it is meant to be embedded anywhere), so it uses the experience the
 * owner's own profile shows by default: the light theme.
 */
function themeFor(days: ContributionDayCell[]): Theme {
  void days;
  return PALETTE.light;
}

// ---------------------------------------------------------------------------
// Layout and rendering
//
// The image is authored as SVG at device resolution and rasterised with resvg.
// Text is real typography — IBM Plex Sans, shaped and antialiased — instead of
// a hand-drawn bitmap font, and every curve (rounded cells, glyph outlines)
// gets proper subpixel coverage. Layout units are CSS pixels; the SVG is built
// at 2x so the PNG is a retina asset.
// ---------------------------------------------------------------------------

const SCALE = 2; // device pixels per CSS pixel

const CELL = 12.5;
const GAP = 3.75;
const STEP = CELL + GAP;
const RADIUS = 2.5;
const PAD = 10;
const LABEL_H = 22;
const WEEKDAY_W = 40;
const FOOTER_H = 28;
const FOOTER_GAP = 13;
const LABEL_SIZE = 8; // months, weekdays, legend, summary — CSS px
const FONT_FAMILY = "IBM Plex Sans";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS: Record<number, string> = {
  1: "Mon",
  3: "Wed",
  5: "Fri",
};

function hex(color: readonly number[]): string {
  return `#${color.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The wasm binary and the font ship as base64 modules rather than as files
 * under `assets/`: Vercel's function tracer only copies what it can resolve
 * statically, and every runtime path we tried (`process.cwd()`, a literal
 * `new URL(..., import.meta.url)`, even `includeFiles` on the functions glob)
 * left the deploy with a function that 500s on first render while local dev
 * worked. Modules are always traced. Regenerate with `pnpm gen-assets`.
 */
const WASM_BYTES = Buffer.from(RESVG_WASM_BASE64, "base64");
const FONT_BYTES = Buffer.from(PLEX_SANS_BASE64, "base64");

let wasmInit: Promise<void> | null = null;
let fontBuffer: Buffer | null = null;

async function rasterize(svg: string): Promise<Buffer> {
  const { initWasm, Resvg } = await import("@resvg/resvg-wasm");
  wasmInit ??= initWasm(WASM_BYTES);
  await wasmInit;
  fontBuffer ??= FONT_BYTES;
  const image = new Resvg(svg, {
    font: {
      defaultFontFamily: FONT_FAMILY,
      fontBuffers: [fontBuffer],
      loadSystemFonts: false,
    },
  });
  return Buffer.from(image.render().asPng());
}

function text(
  value: string,
  x: number,
  baseline: number,
  size: number,
  color: readonly number[],
  width?: number,
): string {
  const track = width === undefined ? "" : ` textLength="${width}" lengthAdjust="spacingAndGlyphs"`;
  return `<text x="${x}" y="${baseline}" font-family="${FONT_FAMILY}" font-size="${size * SCALE}" fill="${hex(color)}"${track}>${xml(value)}</text>`;
}

export function buildHeatmapSvg(input: HeatmapInput): string {
  const today = new Date().toISOString().slice(0, 10);
  const weeks = input.weeks;
  // Fixed at 53 columns so the asset keeps one size no matter how GitHub
  // buckets the rolling year (52 weeks in some alignments): embedders can
  // then hardcode width/height without the browser rescaling the grid.
  const columnCount = Math.max(53, weeks.length);
  const width = Math.ceil(PAD * 2 + WEEKDAY_W + columnCount * STEP - GAP) * SCALE;
  const height = Math.ceil(PAD * 2 + LABEL_H + 7 * STEP - GAP + FOOTER_H) * SCALE;

  const cells: (ContributionDayCell | null)[][] = weeks.map((week) =>
    week.days.map((day) => (day.date <= today ? day : null)),
  );
  const allDays = cells.flatMap((column) =>
    column.filter((cell): cell is ContributionDayCell => cell !== null),
  );
  const levels = levelsForCounts(allDays.map((day) => day.count));
  const levelByDate = new Map<string, ContributionLevel>(
    allDays.map((day, index) => [day.date, levels[index] ?? 0]),
  );
  const theme = themeFor(allDays);

  const pad = PAD * SCALE;
  const cell = CELL * SCALE;
  const step = STEP * SCALE;
  const radius = RADIUS * SCALE;
  const gridX = (PAD + WEEKDAY_W) * SCALE;
  const gridY = (PAD + LABEL_H) * SCALE;
  const parts: string[] = [`<rect width="${width}" height="${height}" fill="${hex(theme.bg)}"/>`];

  // Month labels: first day of each new month, on the strip above the grid.
  const monthBaseline = gridY - 5 * SCALE;
  const seenMonths = new Set<string>();
  for (let column = 0; column < columnCount; column += 1) {
    for (const day of weeks[column]?.days ?? []) {
      if (day.date > today) continue;
      const date = new Date(`${day.date}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) continue;
      const month = MONTHS[date.getUTCMonth()];
      if (!month || seenMonths.has(month)) continue;
      seenMonths.add(month);
      parts.push(
        text(month.slice(0, 3), gridX + column * step, monthBaseline, LABEL_SIZE, theme.text),
      );
      break;
    }
  }

  // Cells
  for (let column = 0; column < weeks.length; column += 1) {
    for (let row = 0; row < 7; row += 1) {
      const day = cells[column]?.[row];
      const level = day ? (levelByDate.get(day.date) ?? 0) : 0;
      const color = day ? (theme.level[level] ?? theme.level[0] ?? [0, 0, 0]) : theme.ghost;
      parts.push(
        `<rect x="${gridX + column * step}" y="${gridY + row * step}" width="${cell}" height="${cell}" rx="${radius}" fill="${hex(color)}"/>`,
      );
    }
  }

  // Weekday labels, right-aligned to the gutter.
  for (const [weekday, label] of Object.entries(WEEKDAYS)) {
    const row = Number(weekday);
    const centre = gridY + row * step + cell / 2;
    const baseline = centre + 0.35 * LABEL_SIZE * SCALE;
    parts.push(
      `<text x="${gridX - 6 * SCALE}" y="${baseline}" text-anchor="end" font-family="${FONT_FAMILY}" font-size="${LABEL_SIZE * SCALE}" fill="${hex(theme.text)}">${xml(label)}</text>`,
    );
  }

  // Footer: total on the left, "Less … More" legend right-aligned to the edge.
  const visibleTotal = allDays.reduce((sum, day) => sum + day.count, 0);
  const summary = `${visibleTotal.toLocaleString("en-US")} contributions in the last year`;
  const footerTop = gridY + 7 * step - GAP * SCALE + FOOTER_GAP * SCALE;
  const footerBaseline = footerTop + 0.78 * LABEL_SIZE * SCALE;
  parts.push(text(summary, pad, footerBaseline, LABEL_SIZE, theme.text));

  const legendGap = 5 * SCALE;
  const legendWord = 2.4 * LABEL_SIZE * SCALE;
  const legendCells = 5 * cell + 4 * GAP * SCALE;
  // Both words are drawn at a fixed width, so the block is exactly these sizes.
  const legendWidth = 2 * legendWord + 2 * legendGap + legendCells;
  const lessX = width - pad - legendWidth;
  const cellsX = lessX + legendWord + legendGap;
  const moreX = cellsX + legendCells + legendGap;
  parts.push(text("Less", lessX, footerBaseline, LABEL_SIZE, theme.text, legendWord));
  for (let level = 0; level < 5; level += 1) {
    const color = theme.level[level] ?? theme.level[0] ?? [0, 0, 0];
    parts.push(
      `<rect x="${cellsX + level * (cell + GAP * SCALE)}" y="${footerBaseline - cell + 2 * SCALE}" width="${cell}" height="${cell}" rx="${radius}" fill="${hex(color)}"/>`,
    );
  }
  parts.push(text("More", moreX, footerBaseline, LABEL_SIZE, theme.text, legendWord));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

export interface HeatmapInput {
  totalContributions: number;
  weeks: ContributionWeek[];
}

export async function heatmapPng(input: HeatmapInput): Promise<Buffer> {
  return rasterize(buildHeatmapSvg(input));
}

export async function renderHeatmapPng(): Promise<Buffer> {
  const data = await fetchContributions();
  return heatmapPng(data);
}
