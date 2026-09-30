import { describe, expect, it } from "vitest";

import appSource from "./App.tsx?raw";
import indexSource from "../index.html?raw";

describe("TaskGlass product branding", () => {
  it("uses the TaskGlass name in the application shell and browser title", () => {
    expect(appSource).toContain("TaskGlass");
    expect(appSource).not.toContain("Annotate It");
    expect(appSource).not.toContain("Annotation Experiment Platform");
    expect(indexSource).toContain("<title>TaskGlass</title>");
  });
});
