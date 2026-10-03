// @vitest-environment jsdom
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import Dashboard from "./Dashboard";

vi.mock("../api", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../api";

const mockApiFetch = vi.mocked(apiFetch);

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders empty state when there are no experiments", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ experiments: [] }),
    } as Response);

    render(<Dashboard />);

    expect(screen.getByText("Loading experiments...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("No experiments yet")).toBeDefined();
      expect(screen.getByRole("button", { name: /create experiment/i })).toBeDefined();
    });
  });

  it("renders experiments with inline status badges and links to /experiments/{id}", async () => {
    const experiments = [
      {
        id: "exp-active-1",
        name: "Active Experiment",
        status: "active",
        share_token: "tok-1",
        created_at: new Date().toISOString(),
      },
      {
        id: "exp-proc-2",
        name: "Processing Experiment",
        status: "draft_media_processing",
        share_token: "tok-2",
        created_at: new Date().toISOString(),
      },
      {
        id: "exp-fail-3",
        name: "Failed Experiment",
        status: "draft_media_failed",
        share_token: "tok-3",
        created_at: new Date().toISOString(),
      },
      {
        id: "exp-draft-4",
        name: "Draft Experiment",
        status: "draft",
        share_token: "tok-4",
        created_at: new Date().toISOString(),
      },
    ];

    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ experiments }),
    } as Response);

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText("Active Experiment")).toBeDefined();
      expect(screen.getByText("Processing Experiment")).toBeDefined();
      expect(screen.getByText("Failed Experiment")).toBeDefined();
      expect(screen.getByText("Draft Experiment")).toBeDefined();
    });

    // Check badges
    expect(screen.getByText("Active")).toBeDefined();
    expect(screen.getByText("Processing dataset")).toBeDefined();
    expect(screen.getByText("Dataset failed")).toBeDefined();
    expect(screen.getByText("Draft")).toBeDefined();

    // Check action buttons:
    // Active should have "View Stats"
    expect(screen.getByRole("button", { name: /view stats/i })).toBeDefined();

    // Inactive (drafts) should have "Configure"
    const configureButtons = screen.getAllByRole("button", { name: /configure/i });
    expect(configureButtons.length).toBe(3);

    // Links should point to /experiments/{id}
    const links = screen.getAllByRole("link");
    const hrefs = links.map(l => l.getAttribute("href"));
    expect(hrefs).toContain("/experiments/exp-active-1");
    expect(hrefs).toContain("/experiments/exp-proc-2");
    expect(hrefs).toContain("/experiments/exp-fail-3");
    expect(hrefs).toContain("/experiments/exp-draft-4");
  });
});
