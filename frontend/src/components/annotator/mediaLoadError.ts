export function shouldReportMediaLoadError(error: unknown, disposed: boolean): boolean {
  const name = error && typeof error === "object" && "name" in error
    ? String((error as { name?: unknown }).name)
    : "";
  return !(disposed && name === "AbortError");
}
