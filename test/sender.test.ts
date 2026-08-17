import { describe, expect, it } from "vitest";
import { cleanSender } from "../lib/sender.js";

describe("cleanSender", () => {
  it("strips markdown bold and a Sender's Name label", () => {
    expect(cleanSender("**Sender's Name:**\nFARMERS INSURANCE.")).toBe("FARMERS INSURANCE");
  });

  it("keeps a verbose legal sender name", () => {
    expect(
      cleanSender("**Shepler v. The Board of Trustees of The California State University**"),
    ).toBe("Shepler v. The Board of Trustees of The California State University");
  });

  it("strips 'the sender's name is' prose", () => {
    expect(
      cleanSender("**Sender's Name:**\nThe sender's name is **The Internal Revenue Service**."),
    ).toBe("The Internal Revenue Service");
  });

  it("returns null for unknown", () => {
    expect(cleanSender("Unknown")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(cleanSender("")).toBeNull();
  });

  it("caps overly long names", () => {
    expect(cleanSender("A".repeat(100))).toBe("A".repeat(80));
  });
});
