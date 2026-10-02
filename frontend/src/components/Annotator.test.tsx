// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import Annotator from "./Annotator";
import { apiFetch } from "../api";

vi.mock("../api", () => ({
  apiFetch: vi.fn(),
  setAuthTokenGetter: vi.fn(),
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
  SignInButton: ({ children }: any) => children,
}));

describe("Annotator with Teaching Examples", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const mockConfig = {
    experiment_name: "Speech Study",
    access_mode: "anonymous",
  };

  const teachingExample = {
    data_unit_id: "u-1",
    media_url: "blob:sample1",
    filename: "sample1.wav",
    displayed_answer: { value: "Clear" },
    explanation: "Observational note.",
  };

  it("serves teaching examples onboarding before the first allocation request", async () => {
    (apiFetch as any).mockImplementation((url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("/configuration")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockConfig),
        });
      }
      if (urlStr.includes("/session")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            session_token: "tok-123",
            experiment_id: "exp-123",
            modality: "audio",
            instructions: "Listen closely",
            label_schema: {
              annotation_type: "categorical",
              schema_version: 1,
              choices: ["Clear", "Noisy"],
              multi_select: false,
            },
            access_mode: "anonymous",
            requires_qualification: false,
            qualification_form: [],
            requires_teaching_examples: true,
            teaching_examples: [teachingExample],
          }),
        });
      }
      if (urlStr.includes("/teaching-examples/complete")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: "completed" }),
        });
      }
      if (urlStr.includes("/next")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data_unit_id: "u-real-1",
            media_url: "blob:real1",
          }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${urlStr}`));
    });

    render(<Annotator shareToken="test-share-token" />);

    // Wait for teaching examples onboarding to render
    await waitFor(() => {
      expect(screen.getByText("Observational Example: How to Annotate")).toBeDefined();
    });

    expect(screen.getByText("Observational note.")).toBeDefined();

    // Verify /next has NOT been called yet
    const nextCallsBefore = (apiFetch as any).mock.calls.filter((call: any[]) =>
      call[0].toString().includes("/next")
    );
    expect(nextCallsBefore.length).toBe(0);

    // Click "Start annotating"
    const startBtn = screen.getByRole("button", { name: /start annotating/i });
    fireEvent.click(startBtn);

    // Verify complete was called and then /next was requested
    await waitFor(() => {
      const completeCalls = (apiFetch as any).mock.calls.filter((call: any[]) =>
        call[0].toString().includes("/teaching-examples/complete")
      );
      expect(completeCalls.length).toBe(1);

      const nextCallsAfter = (apiFetch as any).mock.calls.filter((call: any[]) =>
        call[0].toString().includes("/next")
      );
      expect(nextCallsAfter.length).toBe(1);
    });
  });

  it("skips teaching examples onboarding when requires_teaching_examples is false", async () => {
    (apiFetch as any).mockImplementation((url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("/configuration")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockConfig),
        });
      }
      if (urlStr.includes("/session")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            session_token: "tok-123",
            experiment_id: "exp-123",
            modality: "audio",
            instructions: "Listen closely",
            label_schema: {
              annotation_type: "categorical",
              schema_version: 1,
              choices: ["Clear", "Noisy"],
              multi_select: false,
            },
            access_mode: "anonymous",
            requires_qualification: false,
            qualification_form: [],
            requires_teaching_examples: false,
            teaching_examples: [],
          }),
        });
      }
      if (urlStr.includes("/next")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data_unit_id: "u-real-1",
            media_url: "blob:real1",
          }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${urlStr}`));
    });

    render(<Annotator shareToken="test-share-token" />);

    // Next item is immediately requested without showing onboarding
    await waitFor(() => {
      const nextCalls = (apiFetch as any).mock.calls.filter((call: any[]) =>
        call[0].toString().includes("/next")
      );
      expect(nextCalls.length).toBe(1);
    });

    expect(screen.queryByText("Observational Example: How to Annotate")).toBeNull();
  });
});
