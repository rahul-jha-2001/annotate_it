import { describe, expect, it } from "vitest";

import { shouldReportMediaLoadError } from "./mediaLoadError";

describe("media load error reporting", () => {
  it("ignores only aborts caused by renderer disposal", () => {
    const aborted = new DOMException("signal is aborted without reason", "AbortError");
    expect(shouldReportMediaLoadError(aborted, true)).toBe(false);
    expect(shouldReportMediaLoadError(aborted, false)).toBe(true);
    expect(shouldReportMediaLoadError(new Error("Codec unsupported"), true)).toBe(true);
  });
});
