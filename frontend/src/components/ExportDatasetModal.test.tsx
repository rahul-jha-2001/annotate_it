// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { apiFetch } from "../api";

vi.mock("../api", () => ({ apiFetch: vi.fn() }));

import ExportDatasetModal, {
  calculateNeedReviewCount,
  parseIntegerThreshold,
  parseFloatThreshold,
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
});
