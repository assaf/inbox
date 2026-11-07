import { describe, it, expect } from "vitest";
// @vitest-environment node

import { heatmapPng, levelsForCounts, type ContributionWeek } from "../lib/heatmap.js";

describe("levelsForCounts", () => {
  it("leaves empty days at level 0", () => {
    expect(levelsForCounts([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("splits activity into four quartile levels", () => {
    expect(levelsForCounts([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  it("keeps dominant days at the highest level", () => {
    const levels = levelsForCounts([0, 1, 2, 3, 100]);
    expect(levels[0]).toBe(0);
    expect(levels[4]).toBe(4);
  });

  it("never renders an active day as the empty level", () => {
    const levels = levelsForCounts([0, 20]);
    expect(levels[0]).toBe(0);
    expect(levels[1]).toBeGreaterThan(0);
  });
});

describe("heatmapPng", () => {
  it("renders a 2x PNG whose CSS size is fixed regardless of week count", async () => {
    const weeks: ContributionWeek[] = [];
    const start = new Date("2025-01-05T00:00:00Z"); // Sunday
    for (let column = 0; column < 52; column += 1) {
      const days = [];
      for (let row = 0; row < 7; row += 1) {
        const date = new Date(start.getTime() + (column * 7 + row) * 86400000);
        days.push({
          count: (column + row) % 20,
          date: date.toISOString().slice(0, 10),
        });
      }
      weeks.push({ days });
    }
    const png = await heatmapPng({
      totalContributions: 3000,
      weeks,
    });
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
    // 10px pad + 44px weekday + 53 columns of 16.25px - 3.75px gap, at 2x.
    expect(png.readUInt32BE(16)).toBe(Math.ceil(10 * 2 + 44 + 53 * 16.25 - 3.75) * 2);
    // 10px pad + 26px band + 7 rows of 16.25px + 35px footer, at 2x.
    expect(png.readUInt32BE(20)).toBe(Math.ceil(10 * 2 + 26 + 7 * 16.25 - 3.75 + 35) * 2);
  });
});
