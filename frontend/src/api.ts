type TokenGetter = () => Promise<string | null>;

let getAuthToken: TokenGetter | null = null;

export function setAuthTokenGetter(getter: TokenGetter): void {
  getAuthToken = getter;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = await getAuthToken?.();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers, credentials: "include" });
}
