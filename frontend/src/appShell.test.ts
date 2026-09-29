import { describe, expect, it } from "vitest";

import { showAppHeader, wrapInAppMain } from "./appShell";

describe("application shell routing", () => {
  it("uses landing chrome only on the public homepage", () => {
    expect(showAppHeader("/")).toBe(false);
    expect(showAppHeader("/dashboard")).toBe(true);
    expect(showAppHeader("/catalog")).toBe(true);
  });

  it("does not nest the landing page main landmark inside the app shell", () => {
    expect(wrapInAppMain("/")).toBe(false);
    expect(wrapInAppMain("/dashboard")).toBe(true);
  });
});
