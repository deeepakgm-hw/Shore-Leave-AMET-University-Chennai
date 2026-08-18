import { TokenService } from "@/services/token.service";

export const API = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfterSeconds?: number) { super(message); this.name = "ApiError"; }
}

type RefreshResponse = { token?: string; error?: string; message?: string };
let refreshPromise: Promise<string | null> | null = null;
const REQUEST_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort("request-timeout"), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener("abort", abort, { once: true });
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted) throw new ApiError("The server is taking longer than expected. Please retry.", 408);
    if (error instanceof TypeError) throw new ApiError("The server is temporarily unavailable. Check your connection and retry.", 0);
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}

function handleUnauthorized(token: string | null) {
  TokenService.removeToken();
  if (typeof window === "undefined" || !token || window.location.pathname === "/auth") return;
  const role = TokenService.getRole(token) === "cadet" ? "cadet" : "admin";
  window.location.assign(`/auth?role=${role}&redirect=${encodeURIComponent(window.location.pathname)}`);
}

async function refreshToken(currentToken: string): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = fetchWithTimeout(`${API}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { Authorization: `Bearer ${currentToken}` },
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as RefreshResponse | null;
        if (!response.ok || !payload?.token) return null;
        TokenService.setToken(payload.token);
        return payload.token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function getUsableToken(): Promise<string | null> {
  const token = TokenService.getToken();
  if (!token) return null;
  if (!TokenService.isExpired(token)) return token;
  const refreshed = await refreshToken(token);
  if (refreshed) return refreshed;
  handleUnauthorized(token);
  return null;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token = await getUsableToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response = await fetchWithTimeout(`${API}${path}`, { ...init, credentials: "include", headers });
  if (response.status === 401 && token) {
    const refreshed = await refreshToken(token);
    if (refreshed) {
      token = refreshed;
      headers.set("Authorization", `Bearer ${refreshed}`);
      response = await fetchWithTimeout(`${API}${path}`, { ...init, credentials: "include", headers });
    }
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined;
    if (response.status === 401) handleUnauthorized(token);
    throw new ApiError(payload?.message || payload?.error || `Request failed (${response.status})`, response.status, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
