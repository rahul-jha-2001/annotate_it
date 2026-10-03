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

describe("CreateExperiment - Large-File Bundle Upload Flow", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
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
            progress: { files_processed: 12, files_total: 50 },
            result: null,
          }),
        });
      }
      if (urlStr.includes("/pre-deploy-validation")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            can_deploy: false,
            status: "draft_media_processing",
            orphaned_gold_entries: [],
            missing_from_extraction: [],
            missing_from_metadata: [],
            blocker_reason: "Cannot deploy while media archive is processing",
            registered_count: 0,
            metadata_count: 0,
            gold_count: 0,
          }),
        });
      }
      if (urlStr.includes("/reupload-media") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            message: "Media reset and multipart session initialized",
            upload_id: "fresh-upload-id",
            key: "zip-uploads/exp-bundle-test-123/dataset.zip",
          }),
        });
      }
      if (urlStr.includes("/metadata-preview") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            rows: [],
            columns: [],
            total_declared: 0,
          }),
        });
      }
      if (urlStr.includes("/gold-manifest") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ message: "Gold manifest saved" }),
        });
      }
      if (urlStr.includes("/data-units")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data_units: [] }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${urlStr}`));
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

    // Fill Step 0 (Basics)
    fireEvent.change(screen.getByLabelText("Experiment name"), { target: { value: "Test Large Dataset Experiment" } });
    fireEvent.change(screen.getByLabelText("Instructions for annotators"), { target: { value: "Test instructions content" } });

    const continueBtn = screen.getByRole("button", { name: /Continue/ });
    expect(continueBtn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(continueBtn);

    // Step 1 (Task)
    await waitFor(() => {
      expect(screen.getByText("Interactive annotator preview")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // Step 2 (Dataset bundle)
    await waitFor(() => {
      expect(screen.getByText("Individual Media Files")).toBeDefined();
      expect(screen.getByText("Single Archive (.zip) for Large Datasets")).toBeDefined();
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

    // After upload completes and job is queued/processing, the sticky banner should appear
    await waitFor(() => {
      expect(screen.getByText("Dataset Archive Processing in Background")).toBeDefined();
      expect(screen.getByText(/Extracting & registering files/)).toBeDefined();
    });
  });

  it("allows non-blocking wizard progression while extraction is running and disables deploy on review", async () => {
    await advanceToDatasetStep();

    const bundleTab = screen.getByText("Single Archive (.zip) for Large Datasets");
    fireEvent.click(bundleTab);

    const file = new File(["dummy zip content"], "dataset.zip", { type: "application/zip" });
    const dropzoneInput = screen.getByText("Choose a Dataset Archive (.zip)").closest("label")!.querySelector("input")!;
    fireEvent.change(dropzoneInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("Dataset Archive Processing in Background")).toBeDefined();
    });

    // Click Continue from Step 2 to Step 3
    const continueBtn = screen.getByRole("button", { name: /Continue/ });
    expect(continueBtn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(continueBtn);

    // Step 3 (Dataset preview): notice should indicate media archive is processing in the background
    await waitFor(() => {
      expect(screen.getByText("Media archive is processing in the background")).toBeDefined();
    });

    // Step 3 can be continued immediately without blocking
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // Step 4 (Qualifications)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add question/ })).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // Step 5 (Teaching examples)
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Teaching examples" })).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // Step 6 (Review)
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Review" })).toBeDefined();
    });

    // Sticky banner is still visible on Review step
    expect(screen.getByText("Dataset Archive Processing in Background")).toBeDefined();

    // Deploy button must be disabled while media archive is processing
    const deployBtn = screen.getByRole("button", { name: /Create & deploy/ });
    expect(deployBtn.hasAttribute("disabled")).toBe(true);
    expect(deployBtn.getAttribute("title")).toBe("Cannot deploy while media archive is processing");
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

  it("renders metadata preview with media extracting placeholder and displays validation feedback on step 6", async () => {
    // Override pre-deploy-validation to test warnings and blocking errors
    (apiFetch as any).mockImplementation((input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url || "";
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
      if (urlStr.includes("/experiments") && init?.method === "POST" && !urlStr.includes("/reupload-media") && !urlStr.includes("/metadata-preview") && !urlStr.includes("/gold-manifest")) {
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
            progress: { files_processed: 5, files_total: 20 },
            result: null,
          }),
        });
      }
      if (urlStr.includes("/metadata-preview") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            rows: [{ filename: "sample1.wav", attributes: { accent: "Indian" } }],
            columns: ["accent"],
            total_declared: 1,
          }),
        });
      }
      if (urlStr.includes("/pre-deploy-validation")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            can_deploy: false,
            status: "draft_media_processing",
            orphaned_gold_entries: ["ghost_sample.wav"],
            missing_from_extraction: ["missing1.wav"],
            missing_from_metadata: ["extra1.wav"],
            blocker_reason: "1 gold answer references files never found in the archive",
            registered_count: 5,
            metadata_count: 2,
            gold_count: 1,
          }),
        });
      }
      if (urlStr.includes("/reupload-media") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            message: "Media reset and multipart session initialized",
            upload_id: "new-upload-id",
            key: "zip-uploads/exp-bundle-test-123/dataset.zip",
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    await advanceToDatasetStep();

    const bundleTab = screen.getByText("Single Archive (.zip) for Large Datasets");
    fireEvent.click(bundleTab);

    const file = new File(["dummy zip content"], "dataset.zip", { type: "application/zip" });
    const dropzoneInput = screen.getByText("Choose a Dataset Archive (.zip)").closest("label")!.querySelector("input")!;
    fireEvent.change(dropzoneInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("Dataset Archive Processing in Background")).toBeDefined();
    });

    // Upload metadata CSV
    const csvContent = "filename,accent\nsample1.wav,Indian\nsample2.wav,British";
    const csvFile = new File([csvContent], "metadata.csv", { type: "text/csv" });
    const csvInput = screen.getByText("Upload metadata CSV (optional)").closest("label")!.querySelector("input")!;
    fireEvent.change(csvInput, { target: { files: [csvFile] } });

    await waitFor(() => {
      expect(screen.getByText("CSV loaded — choose another to replace it")).toBeDefined();
    });

    // Click Assemble & preview
    const assembleBtn = screen.getByRole("button", { name: /Assemble & preview/ });
    fireEvent.click(assembleBtn);

    // Step 3 should display table with declared rows and "Media extracting..." placeholder
    await waitFor(() => {
      expect(screen.getByText("sample1.wav")).toBeDefined();
      expect(screen.getByText("sample2.wav")).toBeDefined();
      expect(screen.getAllByText("Media extracting...").length).toBeGreaterThan(0);
    });

    // Step 3 -> Step 4
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // Step 4 -> Step 5
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add question/ })).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // Step 5 -> Step 6
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Teaching examples" })).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // Step 6: Verify validation banners
    await waitFor(() => {
      expect(screen.getByText(/1 gold entries reference files that were never found in the uploaded archive/)).toBeDefined();
      expect(screen.getByText(/ghost_sample\.wav/)).toBeDefined();
      expect(screen.getByText(/1 files listed in your metadata were not found in the archive/)).toBeDefined();
      expect(screen.getByText(/missing1\.wav/)).toBeDefined();
      expect(screen.getByText(/1 extracted files have no metadata row/)).toBeDefined();
    });

    // Deploy button must be disabled due to orphaned gold entries
    const deployBtn = screen.getByRole("button", { name: /Create & deploy/ });
    expect(deployBtn.hasAttribute("disabled")).toBe(true);
  });
});
