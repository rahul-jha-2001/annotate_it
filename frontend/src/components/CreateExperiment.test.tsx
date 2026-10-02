// @vitest-environment jsdom
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import CreateExperiment from "./CreateExperiment";
import { apiFetch } from "../api";

vi.mock("../api", () => ({
  apiFetch: vi.fn(),
  setAuthTokenGetter: vi.fn(),
}));

describe("CreateExperiment - Teaching Examples Step", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    (apiFetch as any).mockImplementation((url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/annotation-types")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              key: "categorical",
              name: "Categorical",
              compatible_modalities: ["audio", "image", "video"],
              supports_choices: true,
              supports_multi_select: true,
              required_interaction: "none",
            },
          ]),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${urlStr}`));
    });
  });

  it("includes Teaching examples in wizard steps list", async () => {
    render(<CreateExperiment />);
    await waitFor(() => {
      expect(screen.getByText("Teaching examples")).toBeDefined();
    });

    const stepElements = screen.getAllByText(/Basics|Task|Dataset bundle|Dataset preview|Qualifications|Teaching examples|Review/);
    expect(stepElements.length).toBeGreaterThanOrEqual(7);
  });

  it("renders wizard step navigation correctly", async () => {
    render(<CreateExperiment />);
    await waitFor(() => {
      expect(screen.getAllByText("Basics").length).toBeGreaterThan(0);
      expect(screen.getByText("Teaching examples")).toBeDefined();
    });

    const progress = screen.getByRole("navigation", { name: "Experiment setup progress" });
    expect(progress.getAttribute("aria-label")).toBe("Experiment setup progress");
    expect(screen.getByText("Step 1 of 7")).toBeDefined();
    expect(within(progress).getByText("Basics").closest("li")?.getAttribute("aria-current")).toBe("step");
  });

  it("exposes the selected annotator access mode", async () => {
    render(<CreateExperiment />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Name required/ })).toBeDefined();
    });

    expect(screen.getByRole("button", { name: /Name required/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Sign-in required/ }).getAttribute("aria-pressed")).toBe("false");
  });
});
