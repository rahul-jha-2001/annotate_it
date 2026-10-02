import { apiFetch } from "../api";

export interface CompletedPart {
  PartNumber: number;
  ETag: string;
}

export interface MultipartProgress {
  percent: number;
  uploadedBytes: number;
  totalBytes: number;
  completedParts: number;
  totalParts: number;
}

export interface MultipartUploadOptions {
  file: File;
  experimentId?: string | null;
  chunkSize?: number;
  concurrency?: number;
  onProgress?: (progress: MultipartProgress) => void;
  abortSignal?: AbortSignal;
}

export interface MultipartUploadResult {
  s3_key: string;
  s3_uri: string;
}

interface CachedUploadState {
  uploadId: string;
  s3Key: string;
  completedParts: CompletedPart[];
  totalParts: number;
  chunkSize: number;
}

const DEFAULT_CHUNK_SIZE = 50 * 1024 * 1024; // 50MB per chunk
const DEFAULT_CONCURRENCY = 4;
const MAX_RETRIES = 3;

export function getUploadCacheKey(file: File): string {
  return `taskglass_upload_${file.name}_${file.size}_${file.lastModified}`;
}

export function getCachedUpload(file: File): CachedUploadState | null {
  try {
    const raw = localStorage.getItem(getUploadCacheKey(file));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearUploadCache(file: File): void {
  try {
    localStorage.removeItem(getUploadCacheKey(file));
  } catch {
    // Ignore storage errors
  }
}

function saveUploadCache(file: File, state: CachedUploadState): void {
  try {
    localStorage.setItem(getUploadCacheKey(file), JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

async function uploadPartWithRetry(
  slice: Blob,
  presignedUrl: string,
  partNumber: number,
  signal?: AbortSignal,
): Promise<string> {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    if (signal?.aborted) {
      throw new DOMException("Upload aborted by user", "AbortError");
    }

    try {
      const response = await fetch(presignedUrl, {
        method: "PUT",
        body: slice,
        signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const etagHeader = response.headers.get("ETag") || response.headers.get("etag");
      if (!etagHeader) {
        // Fallback for mock environments without ETag header
        return `"part-${partNumber}"`;
      }
      return etagHeader;
    } catch (err) {
      if (signal?.aborted) {
        throw err;
      }
      attempt++;
      if (attempt >= MAX_RETRIES) {
        throw new Error(`Part ${partNumber} failed after ${MAX_RETRIES} attempts: ${err instanceof Error ? err.message : String(err)}`);
      }
      const delay = Math.pow(2, attempt) * 500;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error(`Part ${partNumber} failed unexpectedly`);
}

export async function uploadMultipartFile(options: MultipartUploadOptions): Promise<MultipartUploadResult> {
  const {
    file,
    experimentId,
    chunkSize = DEFAULT_CHUNK_SIZE,
    concurrency = DEFAULT_CONCURRENCY,
    onProgress,
    abortSignal,
  } = options;

  const totalBytes = file.size;
  const totalParts = Math.max(1, Math.ceil(totalBytes / chunkSize));

  let uploadId: string;
  let s3Key: string;
  const completedPartsMap = new Map<number, string>();

  // Check cached resume state
  const cached = getCachedUpload(file);
  if (cached && cached.totalParts === totalParts && cached.chunkSize === chunkSize) {
    uploadId = cached.uploadId;
    s3Key = cached.s3Key;
    for (const part of cached.completedParts) {
      completedPartsMap.set(part.PartNumber, part.ETag);
    }
  } else {
    // Start fresh multipart upload
    const initiateRes = await apiFetch("/api/uploads/presign-multipart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        content_type: file.type || "application/zip",
        experiment_id: experimentId,
      }),
      signal: abortSignal,
    });

    if (!initiateRes.ok) {
      const errBody = await initiateRes.json().catch(() => ({}));
      throw new Error(errBody.detail || `Failed to initiate multipart upload: ${initiateRes.statusText}`);
    }

    const initData = await initiateRes.json();
    uploadId = initData.upload_id;
    s3Key = initData.s3_key;

    saveUploadCache(file, {
      uploadId,
      s3Key,
      completedParts: [],
      totalParts,
      chunkSize,
    });
  }

  // Calculate progress
  const emitProgress = () => {
    if (!onProgress) return;
    let uploadedBytes = 0;
    for (let p = 1; p <= totalParts; p++) {
      if (completedPartsMap.has(p)) {
        const start = (p - 1) * chunkSize;
        const end = Math.min(start + chunkSize, totalBytes);
        uploadedBytes += end - start;
      }
    }
    const percent = totalBytes > 0 ? Math.min(100, (uploadedBytes / totalBytes) * 100) : 100;
    onProgress({
      percent,
      uploadedBytes,
      totalBytes,
      completedParts: completedPartsMap.size,
      totalParts,
    });
  };

  emitProgress();

  // Enqueue parts that still need to be uploaded
  const partsToUpload: number[] = [];
  for (let p = 1; p <= totalParts; p++) {
    if (!completedPartsMap.has(p)) {
      partsToUpload.push(p);
    }
  }

  if (partsToUpload.length > 0) {
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < partsToUpload.length) {
        if (abortSignal?.aborted) {
          throw new DOMException("Upload aborted by user", "AbortError");
        }

        const currentIndex = nextIndex++;
        const partNumber = partsToUpload[currentIndex];

        const start = (partNumber - 1) * chunkSize;
        const end = Math.min(start + chunkSize, totalBytes);
        const slice = file.slice(start, end);

        // Get presigned URL for this part
        const presignRes = await apiFetch("/api/uploads/presign-multipart-part", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            s3_key: s3Key,
            upload_id: uploadId,
            part_number: partNumber,
          }),
          signal: abortSignal,
        });

        if (!presignRes.ok) {
          const errData = await presignRes.json().catch(() => ({}));
          throw new Error(errData.detail || `Failed to presign part ${partNumber}`);
        }

        const { presigned_url } = await presignRes.json();

        // Upload the slice to S3/MinIO
        const etag = await uploadPartWithRetry(slice, presigned_url, partNumber, abortSignal);
        completedPartsMap.set(partNumber, etag);

        // Save progress to localStorage
        const currentCompleted: CompletedPart[] = Array.from(completedPartsMap.entries()).map(
          ([PartNumber, ETag]) => ({ PartNumber, ETag })
        );
        saveUploadCache(file, {
          uploadId,
          s3Key,
          completedParts: currentCompleted,
          totalParts,
          chunkSize,
        });

        emitProgress();
      }
    };

    const workerCount = Math.min(concurrency, partsToUpload.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);
  }

  // Complete multipart upload
  const completedPartsList: CompletedPart[] = Array.from(completedPartsMap.entries())
    .map(([PartNumber, ETag]) => ({ PartNumber, ETag }))
    .sort((a, b) => a.PartNumber - b.PartNumber);

  const completeRes = await apiFetch("/api/uploads/complete-multipart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      s3_key: s3Key,
      upload_id: uploadId,
      parts: completedPartsList,
    }),
    signal: abortSignal,
  });

  if (!completeRes.ok) {
    const errBody = await completeRes.json().catch(() => ({}));
    throw new Error(errBody.detail || `Failed to complete multipart upload: ${completeRes.statusText}`);
  }

  const completeData = await completeRes.json();
  clearUploadCache(file);

  return {
    s3_key: completeData.s3_key,
    s3_uri: completeData.s3_uri,
  };
}
