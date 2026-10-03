// @vitest-environment jsdom
import { render, screen, waitFor, cleanup, within, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import CreateExperiment from "./CreateExperiment";
import { apiFetch } from "../api";
import { uploadMultipartFile } from "../services/multipartUpload";

vi.mock("../api", () => ({
  apiFetch: vi.fn(),
  setAuthTokenGetter: vi.fn(),
}));

vi.mock("../services/multipartUpload", () => ({
  uploadMultipartFile: vi.fn(),
  clearUploadCache: vi.fn(),
}));

describe("CreateExperiment - 3-Step Wizard Flow", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, assign: vi.fn(), origin: "http://localhost:3000", search: "" },
    });
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

  it("includes 3 wizard steps in the setup progress list", async () => {
    render(<CreateExperiment />);
    await waitFor(() => {
      expect(screen.getAllByText("Basics").length).toBeGreaterThan(0);
    });

    const progress = screen.getByRole("navigation", { name: "Experiment setup progress" });
    expect(progress.getAttribute("aria-label")).toBe("Experiment setup progress");
    expect(screen.getByText("Step 1 of 3")).toBeDefined();
    expect(within(progress).getByText("Basics")).toBeDefined();
    expect(within(progress).getByText("Task")).toBeDefined();
    expect(within(progress).getByText("Dataset upload")).toBeDefined();
  });

  it("renders wizard step navigation correctly", async () => {
    render(<CreateExperiment />);
    await waitFor(() => {
      expect(screen.getAllByText("Basics").length).toBeGreaterThan(0);
      expect(screen.getByText("Dataset upload")).toBeDefined();
    });

    const progress = screen.getByRole("navigation", { name: "Experiment setup progress" });
    expect(screen.getByText("Step 1 of 3")).toBeDefined();
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

describe("CreateExperiment - Dataset Upload Flow", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, assign: vi.fn(), origin: "http://localhost:3000", search: "" },
    });
    (apiFetch as any).mockImplementation((url: string | URL, init?: any) => {
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
      if (urlStr.endsWith("/api/experiments") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "exp-bundle-test-123" }),
        });
      }
      if (urlStr.includes("/bundle-upload") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ job_id: "job-bundle-test-456", status: "queued" }),
        });
      }
      if (urlStr.includes("/bundle-upload/job-bundle-test-456")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            status: "processing",
            progress: { files_processed: 0, files_total: 10 },
            result: null,
          }),
        });
      }
      if (urlStr.includes("/settings") && init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "exp-bundle-test-123" }),
        });
      }
      if (urlStr.includes("/api/uploads/presign") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            urls: [{ filename: "test.wav", upload_url: "http://upload.mock/test.wav", s3_uri: "s3://b/test.wav" }],
          }),
        });
      }
      if (urlStr.includes("/data-units") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data_units: [{ id: "unit-1", raw_uri: "s3://b/test.wav" }] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    (uploadMultipartFile as any).mockResolvedValue({
      s3_key: "zip-uploads/exp-bundle-test-123/dataset.zip",
    });
  });

  const advanceToDatasetStep = async () => {
    render(<CreateExperiment />);
    await waitFor(() => {
      expect(screen.getByLabelText("Experiment name")).toBeDefined();
    });

    // Fill in Step 0
    fireEvent.change(screen.getByLabelText("Experiment name"), { target: { value: "Test Experiment" } });
    fireEvent.change(screen.getByLabelText("Instructions for annotators"), { target: { value: "Annotate accurately" } });

    // Step 0 -> Step 1
    const continueBtn0 = screen.getByRole("button", { name: /Continue/ });
    fireEvent.click(continueBtn0);

    // Step 1 -> Step 2
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Continue/ })).toBeDefined();
    });
    const continueBtn1 = screen.getByRole("button", { name: /Continue/ });
    fireEvent.click(continueBtn1);

    // Verify on Step 2
    await waitFor(() => {
      expect(screen.getByText("Individual Media Files")).toBeDefined();
    });
  };

  it("renders upload mode selector and toggles to bundle zip dropzone", async () => {
    await advanceToDatasetStep();

    // Default mode is individual files
    expect(screen.getByText("1. Choose audio files")).toBeDefined();

    // Switch to bundle archive mode
    const bundleTab = screen.getByText("Single Archive (.zip) for Large Datasets");
    fireEvent.click(bundleTab);

    await waitFor(() => {
      expect(screen.getByText("Choose a Dataset Archive (.zip)")).toBeDefined();
      expect(screen.getByText(/Archive must contain a top-level/)).toBeDefined();
    });
  });

  it("initiates multipart upload and shows background extraction status banner", async () => {
    await advanceToDatasetStep();

    const bundleTab = screen.getByText("Single Archive (.zip) for Large Datasets");
    fireEvent.click(bundleTab);

    await waitFor(() => {
      expect(screen.getByText("Choose a Dataset Archive (.zip)")).toBeDefined();
    });

    // Select a mock zip file
    const file = new File(["dummy zip content"], "dataset.zip", { type: "application/zip" });
    const dropzoneInput = screen.getByText("Choose a Dataset Archive (.zip)").closest("label")!.querySelector("input")!;
    fireEvent.change(dropzoneInput, { target: { files: [file] } });

    // Expect uploadMultipartFile to be called
    await waitFor(() => {
      expect(uploadMultipartFile).toHaveBeenCalled();
    });

    // After upload completes and job is queued/processing, the banner should appear
    await waitFor(() => {
      expect(screen.getByText("Dataset Archive Processing in Background")).toBeDefined();
      expect(screen.getByText(/Extracting & registering files/)).toBeDefined();
    });
  });

  it("allows clicking 'Finish setup' immediately while archive is processing without blocking on extraction", async () => {
    await advanceToDatasetStep();

    const bundleTab = screen.getByText("Single Archive (.zip) for Large Datasets");
    fireEvent.click(bundleTab);

    const file = new File(["dummy zip content"], "dataset.zip", { type: "application/zip" });
    const dropzoneInput = screen.getByText("Choose a Dataset Archive (.zip)").closest("label")!.querySelector("input")!;
    fireEvent.change(dropzoneInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("Dataset Archive Processing in Background")).toBeDefined();
    });

    // Wizard final action is "Finish setup"
    const finishBtn = screen.getByRole("button", { name: /Finish setup/ });
    expect(finishBtn.hasAttribute("disabled")).toBe(false);

    fireEvent.click(finishBtn);

    // Immediately redirects to the experiment page
    await waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith("/experiments/exp-bundle-test-123");
    });
  });

  it("renders Retry Upload button when upload fails and allows retrying", async () => {
    (uploadMultipartFile as any).mockRejectedValueOnce(new Error("Network disconnect during upload"));

    await advanceToDatasetStep();

    const bundleTab = screen.getByText("Single Archive (.zip) for Large Datasets");
    fireEvent.click(bundleTab);

    const file = new File(["dummy zip content"], "dataset.zip", { type: "application/zip" });
    const dropzoneInput = screen.getByText("Choose a Dataset Archive (.zip)").closest("label")!.querySelector("input")!;
    fireEvent.change(dropzoneInput, { target: { files: [file] } });

    // Expect upload error to be rendered
    await waitFor(() => {
      expect(screen.getByText("Upload encountered an error")).toBeDefined();
      expect(screen.getAllByText("Network disconnect during upload").length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: /Retry Upload/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /Select Another Archive/ })).toBeDefined();
    });

    // Now make upload succeed on retry
    (uploadMultipartFile as any).mockResolvedValueOnce({
      s3_key: "zip-uploads/exp-bundle-test-123/dataset.zip",
    });

    const retryBtn = screen.getByRole("button", { name: /Retry Upload/ });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(uploadMultipartFile).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Dataset Archive Processing in Background")).toBeDefined();
    });
  });

  it("individual files path finishes setup and redirects to experiment page", async () => {
    // Mock global fetch for S3 upload
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    try {
      await advanceToDatasetStep();

      // Select individual file
      const file = new File(["audio-bytes"], "test.wav", { type: "audio/wav" });
      const dropzoneInput = screen.getByText("1. Choose audio files").closest("label")!.querySelector("input")!;
      fireEvent.change(dropzoneInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText("test.wav")).toBeDefined();
      });

      const finishBtn = screen.getByRole("button", { name: /Finish setup/ });
      expect(finishBtn.hasAttribute("disabled")).toBe(false);

      fireEvent.click(finishBtn);

      await waitFor(() => {
        expect(window.location.assign).toHaveBeenCalledWith("/experiments/exp-bundle-test-123");
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
});
