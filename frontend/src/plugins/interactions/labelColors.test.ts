import { describe, expect, it } from "vitest";

import { labelColor } from "./labelColors";

describe("labelColor", () => {
  it("is stable for a label and distinguishes common neighboring labels", () => {
    expect(labelColor("Speaker 1")).toBe(labelColor("Speaker 1"));
    expect(labelColor("Speaker 1")).not.toBe(labelColor("Speaker 2"));
  });
});
