// @vitest-environment jsdom
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import ExperimentDashboard from "./ExperimentDashboard";

vi.mock("../api", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../api";

const mockApiFetch = vi.mocked(apiFetch);

describe("ExperimentDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders processing banner and tabs when experiment status is draft_media_processing", async () => {
    const experiment = {
      id: "exp-123",
      name: "Processing Experiment",
      instructions: "Label images",
      modality: "image",
      label_schema: { type: "classification", classes: ["cat", "dog"] },
      metadata_schema: [],
      access_mode: "anonymous",
      overlap_n: 1,
      gold_ratio: 0.1,
      status: "draft_media_processing",
      share_token: "token-123",
      qualification_form: [],
      routing_rules: [],
      teaching_examples: [],
      pending_metadata: [{ filename: "cat1.jpg" }, { filename: "dog1.jpg" }],
      pending_gold_manifest: [],
      configuration_locked: false,
      created_at: new Date().toISOString(),
    };

    mockApiFetch.mockImplementation(async (input: any) => {
      const url = String(input);
      if (url === "/api/experiments/exp-123") {
        return {
          ok: true,
          json: async () => experiment,
        } as Response;
      }
      if (url === "/api/experiments/exp-123/pre-deploy-validation") {
        return {
          ok: true,
          json: async () => ({
            can_deploy: false,
            status: "draft_media_processing",
            blocker_reason: "Dataset files are still extracting.",
            orphaned_gold_entries: [],
            missing_from_extraction: [],
            missing_from_metadata: [],
          }),
        } as Response;
      }
      if (url === "/api/experiments/exp-123/data-units") {
        return {
          ok: true,
          json: async () => [],
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    render(<ExperimentDashboard experimentId="exp-123" />);

    expect(screen.getByText("Loading experiment…")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Processing Experiment")).toBeDefined();
    });

    // Check status banner
    expect(screen.getByText(/Dataset Archive Processing/i)).toBeDefined();

    // Deploy button should be disabled while processing
    const deployBtn = screen.getByRole("button", { name: /deploy experiment/i });
    expect(deployBtn.hasAttribute("disabled")).toBe(true);
  });

  it("allows deployment when experiment is ready (can_deploy: true)", async () => {
    let currentStatus = "draft";

    const experiment = {
      id: "exp-ready",
      name: "Ready Experiment",
      instructions: "Label images",
      modality: "image",
      label_schema: { type: "classification", classes: ["cat", "dog"] },
      metadata_schema: [],
      access_mode: "anonymous",
      overlap_n: 1,
      gold_ratio: 0.1,
      status: currentStatus,
      share_token: "token-ready",
      qualification_form: [],
      routing_rules: [],
      teaching_examples: [],
      pending_metadata: [],
      pending_gold_manifest: [],
      configuration_locked: false,
      created_at: new Date().toISOString(),
    };

    mockApiFetch.mockImplementation(async (input: any, options?: RequestInit) => {
      const url = String(input);
      if (url === "/api/experiments/exp-ready") {
        return {
          ok: true,
          json: async () => ({ ...experiment, status: currentStatus }),
        } as Response;
      }
      if (url === "/api/experiments/exp-ready/pre-deploy-validation") {
        return {
          ok: true,
          json: async () => ({
            can_deploy: true,
            status: "draft",
            blocker_reason: null,
            orphaned_gold_entries: [],
            missing_from_extraction: [],
            missing_from_metadata: [],
          }),
        } as Response;
      }
      if (url === "/api/experiments/exp-ready/data-units") {
        return {
          ok: true,
          json: async () => [{ id: "du-1", filename: "img1.png", is_gold: false, data: {} }],
        } as Response;
      }
      if (url === "/api/experiments/exp-ready/deploy" && options?.method === "POST") {
        currentStatus = "active";
        return {
          ok: true,
          json: async () => ({ status: "active" }),
        } as Response;
      }
      if (url === "/api/experiments/exp-ready/dashboard") {
        return {
          ok: true,
          json: async () => ({
            completion: { completed_assignments: 0, required_assignments: 10, percent: 0, items_remaining: 10 },
            active_annotators: 0,
            annotators: [],
            items: [],
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    render(<ExperimentDashboard experimentId="exp-ready" />);

    await waitFor(() => {
      expect(screen.getByText("Ready Experiment")).toBeDefined();
    });

    // Deploy button should become enabled once validation returns can_deploy: true
    await waitFor(() => {
      const deployBtn = screen.getByRole("button", { name: /deploy experiment/i });
      expect(deployBtn.hasAttribute("disabled")).toBe(false);
    });

    const deployBtn = screen.getByRole("button", { name: /deploy experiment/i });

    // Click deploy
    fireEvent.click(deployBtn);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/experiments/exp-ready/deploy",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("renders active stats overview when status is active", async () => {
    const experiment = {
      id: "exp-active",
      name: "Active Experiment",
      instructions: "Label images",
      modality: "image",
      label_schema: { type: "classification", classes: ["cat", "dog"] },
      metadata_schema: [],
      access_mode: "anonymous",
      overlap_n: 2,
      gold_ratio: 0.1,
      status: "active",
      share_token: "token-active",
      qualification_form: [],
      routing_rules: [],
      teaching_examples: [],
      pending_metadata: [],
      pending_gold_manifest: [],
      configuration_locked: true,
      created_at: new Date().toISOString(),
    };

    mockApiFetch.mockImplementation(async (input: any) => {
      const url = String(input);
      if (url === "/api/experiments/exp-active") {
        return {
          ok: true,
          json: async () => experiment,
        } as Response;
      }
      if (url === "/api/experiments/exp-active/dashboard") {
        return {
          ok: true,
          json: async () => ({
            completion: { completed_assignments: 8, required_assignments: 20, percent: 40, items_remaining: 12 },
            active_annotators: 3,
            annotators: [],
            items: [],
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    render(<ExperimentDashboard experimentId="exp-active" />);

    await waitFor(() => {
      expect(screen.getByText("Active Experiment")).toBeDefined();
    });

    // Active badge
    expect(screen.getByText("Active")).toBeDefined();

    // Deployed stats
    await waitFor(() => {
      expect(screen.getByText("40%")).toBeDefined();
      expect(screen.getByText("8/20")).toBeDefined();
      expect(screen.getByText("12")).toBeDefined();
    });
  });
});
