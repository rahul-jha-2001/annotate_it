// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  clearUploadCache,
  getCachedUpload,
  getUploadCacheKey,
  uploadMultipartFile,
} from "./multipartUpload";
import { apiFetch } from "../api";

vi.mock("../api", () => ({
  apiFetch: vi.fn(),
}));

describe("multipartUpload service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("calculates deterministic cache key and supports save/clear", () => {
    const file = new File(["test data"], "dataset.zip", { type: "application/zip", lastModified: 1700000000000 });
    const key = getUploadCacheKey(file);
    expect(key).toContain("dataset.zip");
    expect(key).toContain("1700000000000");

    expect(getCachedUpload(file)).toBeNull();
    clearUploadCache(file);
  });

  it("completes full multipart upload flow", async () => {
    // 150 bytes file, chunk size 50 => 3 parts
    const content = new Uint8Array(150);
    const file = new File([content], "big-data.zip", { type: "application/zip" });

    (apiFetch as any).mockImplementation(async (url: string, opts: any) => {
      if (url.includes("/api/uploads/presign-multipart-part")) {
        const body = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({ presigned_url: `https://s3.example.com/part-${body.part_number}`, part_number: body.part_number }),
        };
      }
      if (url.includes("/api/uploads/presign-multipart")) {
        return {
          ok: true,
          json: async () => ({ upload_id: "mp-123", s3_key: "zip-uploads/exp-1/uuid/big-data.zip" }),
        };
      }
      if (url.includes("/api/uploads/complete-multipart")) {
        const body = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({ s3_key: body.s3_key, s3_uri: `s3://bucket/${body.s3_key}` }),
        };
      }
      return { ok: false, statusText: "Not Found" };
    });

    // Mock fetch for S3 PUT
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      return {
        ok: true,
        headers: {
          get: (name: string) => (name.toLowerCase() === "etag" ? `"etag-${url}"` : null),
        },
      };
    });

    const progressUpdates: number[] = [];
    const result = await uploadMultipartFile({
      file,
      experimentId: "exp-1",
      chunkSize: 50,
      concurrency: 2,
      onProgress: p => progressUpdates.push(p.percent),
    });

    expect(result.s3_key).toBe("zip-uploads/exp-1/uuid/big-data.zip");
    expect(result.s3_uri).toBe("s3://bucket/zip-uploads/exp-1/uuid/big-data.zip");
    expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
    // Cache should be cleared on success
    expect(getCachedUpload(file)).toBeNull();
  });

  it("resumes already-completed parts from localStorage", async () => {
    const content = new Uint8Array(100);
    const file = new File([content], "resume.zip", { type: "application/zip" });

    // Seed localStorage with part 1 completed
    const cacheKey = getUploadCacheKey(file);
    localStorage.setItem(cacheKey, JSON.stringify({
      uploadId: "mp-resume-123",
      s3Key: "zip-uploads/exp-1/uuid/resume.zip",
      completedParts: [{ PartNumber: 1, ETag: '"etag-1"' }],
      totalParts: 2,
      chunkSize: 50,
    }));

    (apiFetch as any).mockImplementation(async (url: string, opts: any) => {
      if (url.includes("/api/uploads/presign-multipart-part")) {
        const body = JSON.parse(opts.body);
        expect(body.part_number).toBe(2); // Part 1 must be skipped!
        return {
          ok: true,
          json: async () => ({ presigned_url: "https://s3.example.com/part-2", part_number: 2 }),
        };
      }
      if (url.includes("/api/uploads/complete-multipart")) {
        const body = JSON.parse(opts.body);
        expect(body.parts.length).toBe(2);
        return {
          ok: true,
          json: async () => ({ s3_key: body.s3_key, s3_uri: `s3://bucket/${body.s3_key}` }),
        };
      }
      throw new Error(`Unexpected call: ${url}`);
    });

    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      headers: { get: () => '"etag-2"' },
    }));

    const result = await uploadMultipartFile({
      file,
      experimentId: "exp-1",
      chunkSize: 50,
    });

    expect(result.s3_key).toBe("zip-uploads/exp-1/uuid/resume.zip");
  });
});
