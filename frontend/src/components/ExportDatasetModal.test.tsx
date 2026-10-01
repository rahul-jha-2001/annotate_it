// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { apiFetch } from "../api";

vi.mock("../api", () => ({ apiFetch: vi.fn() }));

import ExportDatasetModal, {
  calculateNeedReviewCount,
  parseIntegerThreshold,
  parseFloatThreshold,
  validatePolicy,
  isFieldVeryPermissive,
  DEFAULT_POLICY,
  ExportJobItem,
  PreflightResponse,
} from "./ExportDatasetModal";

describe("ExportDatasetModal", () => {
  const dummyCounts: PreflightResponse["counts"] = {
    total_samples: 10,
    annotated_samples: 6,
    unannotated_samples: 2,
    gold_samples: 2,
    consensus_accepted_samples: 4,
    accepted_samples: 3,
    low_evidence_samples: 2,
    insufficient_overlap_samples: 1,
    low_agreement_samples: 1,
    tied_samples: 0,
    no_eligible_annotations_samples: 0,
  };

  describe("threshold parser helpers (zero threshold preservation)", () => {
    it("preserves valid 0 values for min_gold_items without reverting to default", () => {
      expect(parseIntegerThreshold("0", 5)).toBe(0);
      expect(parseIntegerThreshold("0")).toBe(0);
      expect(parseIntegerThreshold("3", 5)).toBe(3);
      expect(parseIntegerThreshold("", 5)).toBe(5);
      expect(parseIntegerThreshold("invalid", 5)).toBe(5);
    });

    it("preserves valid 0.0 values for min_gold_score and min_agreement", () => {
      expect(parseFloatThreshold("0", 0.7, 0, 1.0)).toBe(0);
      expect(parseFloatThreshold("0.0", 0.7, 0, 1.0)).toBe(0);
      expect(parseFloatThreshold("0.65", 0.7, 0, 1.0)).toBe(0.65);
      expect(parseFloatThreshold("1.5", 0.7, 0, 1.0)).toBe(1.0);
      expect(parseFloatThreshold("", 0.7, 0, 1.0)).toBe(0.7);
    });
  });

  describe("validatePolicy guardrails (Spec section 4)", () => {
    it("accepts DEFAULT_POLICY with no errors", () => {
      const errors = validatePolicy(DEFAULT_POLICY);
      expect(Object.keys(errors)).toHaveLength(0);
    });

    it("rejects non-positive min_annotations_for_consensus", () => {
      expect(validatePolicy({ ...DEFAULT_POLICY, min_annotations_for_consensus: 0 })).toHaveProperty(
        "min_annotations_for_consensus"
      );
      expect(validatePolicy({ ...DEFAULT_POLICY, min_annotations_for_consensus: -1 })).toHaveProperty(
        "min_annotations_for_consensus"
      );
    });

    it("rejects non-positive low_evidence_threshold", () => {
      expect(validatePolicy({ ...DEFAULT_POLICY, low_evidence_threshold: 0 })).toHaveProperty(
        "low_evidence_threshold"
      );
    });

    it("allows min_gold_items: 0 but rejects negative values", () => {
      expect(validatePolicy({ ...DEFAULT_POLICY, min_gold_items: 0 })).not.toHaveProperty(
        "min_gold_items"
      );
      expect(validatePolicy({ ...DEFAULT_POLICY, min_gold_items: -1 })).toHaveProperty(
        "min_gold_items"
      );
    });

    it("constrains min_gold_score and min_agreement to [0.0, 1.0]", () => {
      expect(validatePolicy({ ...DEFAULT_POLICY, min_gold_score: 0.0 })).not.toHaveProperty("min_gold_score");
      expect(validatePolicy({ ...DEFAULT_POLICY, min_gold_score: 1.0 })).not.toHaveProperty("min_gold_score");
      expect(validatePolicy({ ...DEFAULT_POLICY, min_gold_score: -0.1 })).toHaveProperty("min_gold_score");
      expect(validatePolicy({ ...DEFAULT_POLICY, min_gold_score: 1.05 })).toHaveProperty("min_gold_score");

      expect(validatePolicy({ ...DEFAULT_POLICY, min_agreement: 0.0 })).not.toHaveProperty("min_agreement");
      expect(validatePolicy({ ...DEFAULT_POLICY, min_agreement: 1.0 })).not.toHaveProperty("min_agreement");
      expect(validatePolicy({ ...DEFAULT_POLICY, min_agreement: -0.01 })).toHaveProperty("min_agreement");
      expect(validatePolicy({ ...DEFAULT_POLICY, min_agreement: 1.5 })).toHaveProperty("min_agreement");
    });

    it("rejects negative prior_strength", () => {
      expect(validatePolicy({ ...DEFAULT_POLICY, prior_strength: 0.0 })).not.toHaveProperty("prior_strength");
      expect(validatePolicy({ ...DEFAULT_POLICY, prior_strength: -0.5 })).toHaveProperty("prior_strength");
    });
  });

  describe("isFieldVeryPermissive (Spec Section 4)", () => {
    it("flags min_annotations_for_consensus only at floor 1", () => {
      expect(isFieldVeryPermissive("min_annotations_for_consensus", 1)).toBe(true);
      expect(isFieldVeryPermissive("min_annotations_for_consensus", 2)).toBe(false);
      expect(isFieldVeryPermissive("min_annotations_for_consensus", 3)).toBe(false);
    });

    it("flags min_gold_items when <= 1", () => {
      expect(isFieldVeryPermissive("min_gold_items", 0)).toBe(true);
      expect(isFieldVeryPermissive("min_gold_items", 1)).toBe(true);
      expect(isFieldVeryPermissive("min_gold_items", 2)).toBe(false);
      expect(isFieldVeryPermissive("min_gold_items", 5)).toBe(false);
    });

    it("flags min_gold_score when <= 0.3", () => {
      expect(isFieldVeryPermissive("min_gold_score", 0.0)).toBe(true);
      expect(isFieldVeryPermissive("min_gold_score", 0.3)).toBe(true);
      expect(isFieldVeryPermissive("min_gold_score", 0.35)).toBe(false);
      expect(isFieldVeryPermissive("min_gold_score", 0.7)).toBe(false);
    });

    it("flags min_agreement when <= 0.3", () => {
      expect(isFieldVeryPermissive("min_agreement", 0.1)).toBe(true);
      expect(isFieldVeryPermissive("min_agreement", 0.3)).toBe(true);
      expect(isFieldVeryPermissive("min_agreement", 0.4)).toBe(false);
      expect(isFieldVeryPermissive("min_agreement", 0.6)).toBe(false);
    });

    it("flags prior_strength when 0", () => {
      expect(isFieldVeryPermissive("prior_strength", 0)).toBe(true);
      expect(isFieldVeryPermissive("prior_strength", 0.5)).toBe(false);
      expect(isFieldVeryPermissive("prior_strength", 2.0)).toBe(false);
    });
  });

  describe("calculateNeedReviewCount (Finding 2 correctness)", () => {
    it("includes unannotated and excluded low-evidence samples when include_low_evidence is false", () => {
      // insufficient_overlap (1) + low_agreement (1) + tied (0) + no_eligible (0) + unannotated (2) + low_evidence (2) = 6
      const count = calculateNeedReviewCount(dummyCounts, false);
      expect(count).toBe(6);
    });

    it("omits low-evidence samples from need-review count when include_low_evidence is true", () => {
      // insufficient_overlap (1) + low_agreement (1) + tied (0) + no_eligible (0) + unannotated (2) = 4
      const count = calculateNeedReviewCount(dummyCounts, true);
      expect(count).toBe(4);
    });

    it("includes unannotated samples even if no other review flags exist", () => {
      const countsOnlyUnannotated: PreflightResponse["counts"] = {
        total_samples: 5,
        annotated_samples: 0,
        unannotated_samples: 5,
        gold_samples: 0,
        consensus_accepted_samples: 0,
        accepted_samples: 0,
        low_evidence_samples: 0,
        insufficient_overlap_samples: 0,
        low_agreement_samples: 0,
        tied_samples: 0,
        no_eligible_annotations_samples: 0,
      };
      expect(calculateNeedReviewCount(countsOnlyUnannotated, false)).toBe(5);
    });
  });

  describe("static and state rendering", () => {
    it("renders export modes and dialog headers", () => {
      const markup = renderToStaticMarkup(
        createElement(ExportDatasetModal, {
          experimentId: "11111111-1111-1111-1111-111111111111",
          experimentName: "Audio Quality Benchmark",
          onClose: () => {},
        })
      );

      expect(markup).toContain("Export Dataset");
      expect(markup).toContain("Audio Quality Benchmark");
      expect(markup).toContain("Complete Archive");
      expect(markup).toContain("Consensus Dataset");
      expect(markup).toContain("Audit &amp; Research");
      expect(markup).toContain("Training Ready");
    });
  });

  describe("API response fixture smoke checks", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("models a stale-preflight refresh response sequence", async () => {
      let preflightFetchCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes("/exports/preflight")) {
          preflightFetchCount++;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              mode: "consensus",
              policy: {
                min_annotations_for_consensus: 2,
                low_evidence_threshold: 3,
                min_gold_items: 5,
                min_gold_score: 0.7,
                min_agreement: 0.6,
                include_low_evidence: false,
                prior_strength: 2.0,
              },
              source_fingerprint: `fp-${preflightFetchCount}`,
              source_cutoff_at: new Date().toISOString(),
              counts: dummyCounts,
              annotator_summary: {
                total_annotators: 3,
                eligible_annotators: 3,
                excluded_annotators: 0,
                insufficient_gold_annotators: 0,
              },
              estimated_size_bytes: 100000,
              training_ready: false,
              warnings: ["Sample 2 unannotated"],
            }),
          };
        }
        if (url.includes("/exports") && init?.method === "POST") {
          // Simulate 409 Conflict (source changed after preflight)
          return {
            ok: false,
            status: 409,
            json: async () => ({ detail: "Source dataset was modified since preflight" }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => [],
        };
      });

      // Verify that 409 initiates a refresh of preflight
      expect(preflightFetchCount).toBe(0);
      const preflightRes = await fetch("/api/experiments/1/exports/preflight", { method: "POST" });
      const preflightData = await preflightRes.json();
      expect(preflightData.source_fingerprint).toBe("fp-1");

      const createRes = await fetch("/api/experiments/1/exports", { method: "POST" });
      expect(createRes.status).toBe(409);

      // On 409 the client invokes fetchPreflight again
      const refreshedRes = await fetch("/api/experiments/1/exports/preflight", { method: "POST" });
      const refreshedData = await refreshedRes.json();
      expect(refreshedData.source_fingerprint).toBe("fp-2");
      expect(preflightFetchCount).toBe(2);
    });

    it("models running-to-ready polling responses", async () => {
      let pollCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/exports/job-123")) {
          pollCount++;
          const status = pollCount >= 3 ? "ready" : "running";
          return {
            ok: true,
            status: 200,
            json: async (): Promise<Partial<ExportJobItem>> => ({
              id: "job-123",
              experiment_id: "exp-1",
              mode: "consensus",
              status,
              size_bytes: status === "ready" ? 1048576 : null,
              sha256: status === "ready" ? "a1b2c3d4e5f6" : null,
              created_at: new Date().toISOString(),
              started_at: new Date().toISOString(),
              completed_at: status === "ready" ? new Date().toISOString() : null,
              expires_at: status === "ready" ? new Date(Date.now() + 600000).toISOString() : null,
            }),
          };
        }
        return { ok: true, status: 200, json: async () => [] };
      });

      // Step 1: Poll returns running
      const res1 = await fetch("/api/experiments/exp-1/exports/job-123");
      const job1 = await res1.json();
      expect(job1.status).toBe("running");

      // Step 2: Poll returns running
      const res2 = await fetch("/api/experiments/exp-1/exports/job-123");
      const job2 = await res2.json();
      expect(job2.status).toBe("running");

      // Step 3: Poll returns ready
      const res3 = await fetch("/api/experiments/exp-1/exports/job-123");
      const job3 = await res3.json();
      expect(job3.status).toBe("ready");
      expect(job3.sha256).toBe("a1b2c3d4e5f6");
      expect(pollCount).toBe(3);
    });

    it("models a download-generation response", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes("/exports/job-123/download") && init?.method === "POST") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              download_url: "https://s3.example.com/exports/taskglass-exp-123.zip?token=xyz",
              filename: "taskglass-exp-123.zip",
              expires_in: 3600,
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({ detail: "Not found" }) };
      });

      const res = await fetch("/api/experiments/exp-1/exports/job-123/download", { method: "POST" });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.download_url).toContain("taskglass-exp-123.zip");
      expect(data.filename).toBe("taskglass-exp-123.zip");
    });

    it("models failed-job response fields", async () => {
      const failedJob: Partial<ExportJobItem> = {
        id: "job-fail-1",
        experiment_id: "exp-1",
        mode: "consensus",
        status: "failed",
        error_code: "worker_timeout",
        error_message: "Export job timed out after exceeding 1800s lease limit or worker crashed.",
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => failedJob,
      });

      const res = await fetch("/api/experiments/exp-1/exports/job-fail-1");
      const data = await res.json();
      expect(data.status).toBe("failed");
      expect(data.error_code).toBe("worker_timeout");
      expect(data.error_message).toContain("worker crashed");
    });

    it("models an expired-job response", async () => {
      const expiredJob: Partial<ExportJobItem> = {
        id: "job-exp-1",
        experiment_id: "exp-1",
        mode: "complete",
        status: "expired",
        created_at: new Date(Date.now() - 1000000).toISOString(),
        expires_at: new Date(Date.now() - 50000).toISOString(),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => expiredJob,
      });

      const res = await fetch("/api/experiments/exp-1/exports/job-exp-1");
      const data = await res.json();
      expect(data.status).toBe("expired");
    });
  });
});
const apiMock = vi.mocked(apiFetch);
const dummyInteractiveCounts: PreflightResponse["counts"] = {
  total_samples: 2,
  annotated_samples: 2,
  unannotated_samples: 0,
  gold_samples: 0,
  consensus_accepted_samples: 2,
  accepted_samples: 2,
  low_evidence_samples: 0,
  insufficient_overlap_samples: 0,
  low_agreement_samples: 0,
  tied_samples: 0,
  no_eligible_annotations_samples: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function preflightResponse(fingerprint: string): PreflightResponse {
  return {
    mode: "complete",
    policy: {
      min_annotations_for_consensus: 2,
      low_evidence_threshold: 3,
      min_gold_items: 5,
      min_gold_score: 0.7,
      min_agreement: 0.6,
      include_low_evidence: false,
      prior_strength: 2,
    },
    source_fingerprint: fingerprint,
    source_cutoff_at: "2026-10-01T00:00:00Z",
    counts: { ...dummyInteractiveCounts },
    annotator_summary: {
      total_annotators: 2,
      eligible_annotators: 2,
      excluded_annotators: 0,
      insufficient_gold_annotators: 0,
    },
    estimated_size_bytes: 1024,
    training_ready: true,
    warnings: [],
  };
}

describe("ExportDatasetModal interactions", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("refreshes the real preflight view after a stale export response", async () => {
    let preflightCalls = 0;
    apiMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/exports/preflight")) {
        preflightCalls += 1;
        return jsonResponse(preflightResponse(`fingerprint-${preflightCalls}`));
      }
      if (url.endsWith("/exports") && init?.method === "POST") {
        return jsonResponse({ detail: "Source dataset was modified since preflight" }, 409);
      }
      if (url.endsWith("/exports")) return jsonResponse([]);
      throw new Error(`Unexpected API call: ${url}`);
    });

    render(
      <ExportDatasetModal experimentId="exp-1" experimentName="Test experiment" onClose={() => {}} />
    );
    await screen.findByText("Preflight Summary");
    await userEvent.click(screen.getByRole("button", { name: /Generate Complete ZIP/ }));

    await waitFor(() => expect(preflightCalls).toBe(2));
    expect(
      await screen.findByText("Source dataset was modified since preflight")
    ).toBeTruthy();
  });

  it("polls the real modal to ready and downloads the generated archive", async () => {
    const queuedJob: ExportJobItem = {
      id: "job-123",
      experiment_id: "exp-1",
      mode: "complete",
      status: "queued",
      policy: {},
      source_cutoff_at: "2026-10-01T00:00:00Z",
      source_fingerprint: "fingerprint-1",
      warnings: [],
      size_bytes: null,
      sha256: null,
      error_code: null,
      error_message: null,
      created_at: "2026-10-01T00:00:00Z",
      started_at: null,
      completed_at: null,
      expires_at: null,
    };
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    apiMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/exports/preflight")) return jsonResponse(preflightResponse("fingerprint-1"));
      if (url.endsWith("/exports") && init?.method === "POST") return jsonResponse(queuedJob, 202);
      if (url.endsWith("/exports/job-123") && (!init?.method || init.method === "GET")) {
        return jsonResponse({
          ...queuedJob,
          status: "ready",
          size_bytes: 1024,
          sha256: "abc123",
          completed_at: "2026-10-01T00:01:00Z",
        });
      }
      if (url.endsWith("/exports/job-123/download") && init?.method === "POST") {
        return jsonResponse({ download_url: "https://example.test/export.zip", filename: "export.zip" });
      }
      if (url.endsWith("/exports")) return jsonResponse([]);
      throw new Error(`Unexpected API call: ${url}`);
    });
    render(
      <ExportDatasetModal experimentId="exp-1" experimentName="Test experiment" onClose={() => {}} />
    );
    await screen.findByText("Preflight Summary");
    await userEvent.click(screen.getByRole("button", { name: /Generate Complete ZIP/ }));
    expect(await screen.findByText("Export Queued")).toBeTruthy();
    expect(await screen.findByText("Export Ready for Download", {}, { timeout: 3000 })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Download ZIP Archive/ }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());
    expect(apiMock).toHaveBeenCalledWith(
      "/api/experiments/exp-1/exports/job-123/download",
      { method: "POST" }
    );
  });

  it("renders consensus thresholds panel and toggles advanced settings in consensus mode", async () => {
    apiMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/exports/preflight")) return jsonResponse(preflightResponse("fingerprint-1"));
      if (url.endsWith("/exports")) return jsonResponse([]);
      throw new Error(`Unexpected API call: ${url}`);
    });

    render(
      <ExportDatasetModal experimentId="exp-1" experimentName="Test experiment" onClose={() => {}} />
    );
    await screen.findByText("Preflight Summary");

    // Initially complete mode: guardrails panel not shown
    expect(screen.queryByText("Consensus Guardrail Thresholds")).toBeNull();

    // Click consensus card
    await userEvent.click(screen.getByText("Consensus Dataset"));

    // Guardrails panel now visible with defaults
    expect(await screen.findByText("Consensus Guardrail Thresholds")).toBeTruthy();
    expect((screen.getByLabelText("Min annotations for consensus") as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText("Low evidence threshold") as HTMLInputElement).value).toBe("3");
    expect((screen.getByLabelText("Min gold items before exclusion") as HTMLInputElement).value).toBe("5");
    expect((screen.getByLabelText("Min gold score threshold") as HTMLInputElement).value).toBe("0.7");
    expect((screen.getByLabelText("Min item agreement") as HTMLInputElement).value).toBe("0.6");
    expect((screen.getByLabelText("Include low evidence items in final dataset") as HTMLInputElement).checked).toBe(false);

    // Advanced accordion toggle
    expect(screen.queryByLabelText("Prior Strength")).toBeNull();
    const advancedToggle = screen.getByText(/Advanced Settings/);
    await userEvent.click(advancedToggle);
    expect((screen.getByLabelText("Prior Strength") as HTMLInputElement).value).toBe("2");

    // Modify a value and test Reset to defaults
    const minGoldItemsInput = screen.getByLabelText("Min gold items before exclusion") as HTMLInputElement;
    fireEvent.change(minGoldItemsInput, { target: { value: "2" } });
    expect(minGoldItemsInput.value).toBe("2");

    const resetButton = screen.getByRole("button", { name: /Reset to defaults/ });
    await userEvent.click(resetButton);
    expect((screen.getByLabelText("Min gold items before exclusion") as HTMLInputElement).value).toBe("5");
  });

  it("renders live preview 'At these settings:' breakdown in consensus mode", async () => {
    const customPreflight: PreflightResponse = {
      ...preflightResponse("fingerprint-breakdown"),
      counts: {
        total_samples: 10,
        annotated_samples: 8,
        unannotated_samples: 1,
        gold_samples: 1,
        consensus_accepted_samples: 7,
        accepted_samples: 7,
        low_evidence_samples: 0,
        insufficient_overlap_samples: 1,
        low_agreement_samples: 0,
        tied_samples: 2,
        no_eligible_annotations_samples: 0,
      },
      annotator_summary: {
        total_annotators: 8,
        eligible_annotators: 5,
        excluded_annotators: 3,
        insufficient_gold_annotators: 3,
      },
    };

    apiMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/exports/preflight")) return jsonResponse(customPreflight);
      if (url.endsWith("/exports")) return jsonResponse([]);
      throw new Error(`Unexpected API call: ${url}`);
    });

    render(
      <ExportDatasetModal experimentId="exp-1" experimentName="Test experiment" onClose={() => {}} />
    );
    await screen.findByText("Preflight Summary");
    await userEvent.click(screen.getByText("Consensus Dataset"));

    // Verify live preview card matches spec breakdown format
    expect(await screen.findByText("At these settings:")).toBeTruthy();
    expect(screen.getAllByText("7").length).toBeGreaterThan(0);
    expect(screen.getByText("training-ready")).toBeTruthy();
    expect(screen.getByText("needs review (tie)")).toBeTruthy();
    expect(screen.getByText("needs review (insufficient overlap)")).toBeTruthy();
    expect(screen.getByText("excluded (insufficient gold evidence)")).toBeTruthy();

    // Verify audit immutability notice is visible
    expect(
      screen.getByText(
        /Each generated export is a new, independently fingerprinted and timestamped snapshot. Prior exports are never modified./
      )
    ).toBeTruthy();
  });

  it("submits configured consensus policy to export endpoint", async () => {
    let capturedBody: any = null;
    apiMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/exports/preflight")) return jsonResponse(preflightResponse("fp-consensus"));
      if (url.endsWith("/exports") && init?.method === "POST") {
        capturedBody = JSON.parse(String(init.body));
        return jsonResponse(
          {
            id: "job-cons-1",
            experiment_id: "exp-1",
            mode: "consensus",
            status: "queued",
            policy: capturedBody.policy,
            source_cutoff_at: "2026-10-01T00:00:00Z",
            source_fingerprint: "fp-consensus",
            warnings: [],
            size_bytes: null,
            sha256: null,
            error_code: null,
            error_message: null,
            created_at: "2026-10-01T00:00:00Z",
            started_at: null,
            completed_at: null,
            expires_at: null,
          },
          202
        );
      }
      if (url.endsWith("/exports/job-cons-1")) {
        return jsonResponse({
          id: "job-cons-1",
          status: "queued",
          mode: "consensus",
          experiment_id: "exp-1",
          created_at: "2026-10-01T00:00:00Z",
        });
      }
      if (url.endsWith("/exports")) return jsonResponse([]);
      throw new Error(`Unexpected API call: ${url}`);
    });

    render(
      <ExportDatasetModal experimentId="exp-1" experimentName="Test experiment" onClose={() => {}} />
    );
    await screen.findByText("Preflight Summary");
    await userEvent.click(screen.getByText("Consensus Dataset"));
    expect(await screen.findByText("Consensus Guardrail Thresholds")).toBeTruthy();

    const minGoldItemsInput = screen.getByLabelText("Min gold items before exclusion");
    fireEvent.change(minGoldItemsInput, { target: { value: "3" } });

    // Click submit
    const submitBtn = await screen.findByRole("button", { name: /Generate Consensus ZIP/ });
    await userEvent.click(submitBtn);

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect(capturedBody.mode).toBe("consensus");
    expect(capturedBody.policy.min_gold_items).toBe(3);
    expect(capturedBody.policy.min_annotations_for_consensus).toBe(2);
    expect(capturedBody.policy.low_evidence_threshold).toBe(3);
  });

  it("disables export button when thresholds violate guardrails", async () => {
    apiMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/exports/preflight")) return jsonResponse(preflightResponse("fp-guardrail"));
      if (url.endsWith("/exports")) return jsonResponse([]);
      throw new Error(`Unexpected API call: ${url}`);
    });

    render(
      <ExportDatasetModal experimentId="exp-1" experimentName="Test experiment" onClose={() => {}} />
    );
    await screen.findByText("Preflight Summary");
    await userEvent.click(screen.getByText("Consensus Dataset"));
    expect(await screen.findByText("Consensus Guardrail Thresholds")).toBeTruthy();

    const submitBtn = screen.getByRole("button", { name: /Generate Consensus ZIP/ });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(false);

    // Set invalid threshold (min_annotations_for_consensus = 0)
    const minAnnotationsInput = screen.getByLabelText("Min annotations for consensus");
    fireEvent.change(minAnnotationsInput, { target: { value: "0" } });

    // Expect validation error message and disabled submit button
    expect(await screen.findByText("Must be an integer ≥ 1")).toBeTruthy();
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders persistent directional framing and help tags for fields in consensus mode", async () => {
    apiMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/exports/preflight")) return jsonResponse(preflightResponse("fp-help"));
      if (url.endsWith("/exports")) return jsonResponse([]);
      throw new Error(`Unexpected API call: ${url}`);
    });

    render(
      <ExportDatasetModal experimentId="exp-1" experimentName="Test experiment" onClose={() => {}} />
    );
    await screen.findByText("Preflight Summary");
    await userEvent.click(screen.getByText("Consensus Dataset"));
    expect(await screen.findByText("Consensus Guardrail Thresholds")).toBeTruthy();

    // Section 1: Persistent directional framing
    expect(
      screen.getByText(
        "Lower thresholds accept more data with less certainty it's correct. Higher thresholds are stricter and flag more items for manual review."
      )
    ).toBeTruthy();

    // Section 2: Help tag icons with descriptive text
    expect(
      screen.getByTitle(
        /The minimum number of people who must have labeled an item before the system will attempt to produce a single answer for it/
      )
    ).toBeTruthy();
    expect(
      screen.getByTitle(
        /Even if an item is accepted, it's still marked 'low evidence' if fewer than this many people annotated it/
      )
    ).toBeTruthy();
    expect(
      screen.getByTitle(
        /How many gold \(known-correct\) items an annotator needs to have completed before their accuracy score is trusted/
      )
    ).toBeTruthy();
    expect(
      screen.getByTitle(
        /The minimum accuracy \(compared to the correct answer\) an annotator needs on gold items to stay eligible/
      )
    ).toBeTruthy();
    expect(
      screen.getByTitle(
        /How much independent annotators need to agree with each other before their answer is accepted automatically/
      )
    ).toBeTruthy();
    expect(
      screen.getByTitle(
        /Items marked 'low evidence' \(see above\) still have an answer — this toggle decides whether that answer is included/
      )
    ).toBeTruthy();
  });

  it("renders persistent risk note and help tag for prior_strength in advanced settings", async () => {
    apiMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/exports/preflight")) return jsonResponse(preflightResponse("fp-risk"));
      if (url.endsWith("/exports")) return jsonResponse([]);
      throw new Error(`Unexpected API call: ${url}`);
    });

    render(
      <ExportDatasetModal experimentId="exp-1" experimentName="Test experiment" onClose={() => {}} />
    );
    await screen.findByText("Preflight Summary");
    await userEvent.click(screen.getByText("Consensus Dataset"));
    expect(await screen.findByText("Consensus Guardrail Thresholds")).toBeTruthy();

    // Expand advanced settings
    await userEvent.click(screen.getByText(/Advanced Settings/));

    // Section 3: Persistent risk note
    expect(
      screen.getByText(
        /At 0, an annotator's reliability is based purely on the gold items they've personally seen — risky if most annotators have seen only one or two/
      )
    ).toBeTruthy();

    // Help tag for prior strength
    expect(
      screen.getByTitle(
        /This controls how much the system leans on a general assumption of 'average' reliability versus an individual annotator's own gold-item track record/
      )
    ).toBeTruthy();
  });

  it("displays 'very permissive' visual indicator when fields are aggressively loosened", async () => {
    apiMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/exports/preflight")) return jsonResponse(preflightResponse("fp-permissive"));
      if (url.endsWith("/exports")) return jsonResponse([]);
      throw new Error(`Unexpected API call: ${url}`);
    });

    render(
      <ExportDatasetModal experimentId="exp-1" experimentName="Test experiment" onClose={() => {}} />
    );
    await screen.findByText("Preflight Summary");
    await userEvent.click(screen.getByText("Consensus Dataset"));
    expect(await screen.findByText("Consensus Guardrail Thresholds")).toBeTruthy();

    // Initially at defaults: no very permissive badge
    expect(screen.queryByText("very permissive")).toBeNull();

    // Set min_annotations_for_consensus = 1 (floor)
    const minAnnotationsInput = screen.getByLabelText("Min annotations for consensus");
    fireEvent.change(minAnnotationsInput, { target: { value: "1" } });
    expect(screen.getAllByText("very permissive").length).toBe(1);

    // Set min_agreement = 0.25 (<= 0.3)
    const minAgreementInput = screen.getByLabelText("Min item agreement");
    fireEvent.change(minAgreementInput, { target: { value: "0.25" } });
    expect(screen.getAllByText("very permissive").length).toBe(2);
  });

  it("supports per-field reset buttons to revert individual fields to defaults", async () => {
    apiMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/exports/preflight")) return jsonResponse(preflightResponse("fp-reset"));
      if (url.endsWith("/exports")) return jsonResponse([]);
      throw new Error(`Unexpected API call: ${url}`);
    });

    render(
      <ExportDatasetModal experimentId="exp-1" experimentName="Test experiment" onClose={() => {}} />
    );
    await screen.findByText("Preflight Summary");
    await userEvent.click(screen.getByText("Consensus Dataset"));
    expect(await screen.findByText("Consensus Guardrail Thresholds")).toBeTruthy();

    const minGoldItemsInput = screen.getByLabelText("Min gold items before exclusion") as HTMLInputElement;
    const minAgreementInput = screen.getByLabelText("Min item agreement") as HTMLInputElement;

    // Modify both fields
    fireEvent.change(minGoldItemsInput, { target: { value: "2" } });
    fireEvent.change(minAgreementInput, { target: { value: "0.45" } });
    expect(minGoldItemsInput.value).toBe("2");
    expect(minAgreementInput.value).toBe("0.45");

    // Click per-field reset for min_gold_items only
    const resetGoldBtn = screen.getByRole("button", { name: "Reset min_gold_items to default" });
    await userEvent.click(resetGoldBtn);

    // min_gold_items is restored to 5, min_agreement remains 0.45
    expect(minGoldItemsInput.value).toBe("5");
    expect(minAgreementInput.value).toBe("0.45");
  });
});
