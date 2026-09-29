export function showAppHeader(path: string): boolean {
  return path !== "/";
}

export function wrapInAppMain(path: string): boolean {
  return path !== "/";
}
