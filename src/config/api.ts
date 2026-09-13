import { invoke } from "@tauri-apps/api/core";

// Opinion Insights API Configuration
// Production builds strictly target the live HTTPS API endpoint: https://api.opinioninsights.in/api

export const API_BASE: string =
  typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window) && !("__TAURI__" in window)
    ? "/api"
    : (import.meta.env.VITE_API_BASE || "https://api.opinioninsights.in/api");

interface NativeHttpResponse {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  body: string;
}

type TokenGetter = () => string | null;
type TokenRefresher = () => Promise<boolean>;

let activeTokenGetter: TokenGetter | null = null;
let activeTokenRefresher: TokenRefresher | null = null;

export function registerAuthBridge(getter: TokenGetter, refresher: TokenRefresher) {
  activeTokenGetter = getter;
  activeTokenRefresher = refresher;
}

async function performFetch(url: string, init?: RequestInit): Promise<Response> {
  const isTauri = typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

  if (isTauri) {
    try {
      const method = init?.method || "GET";
      const headers: Record<string, string> = {};

      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((val, key) => {
            headers[key] = val;
          });
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([key, val]) => {
            headers[key] = val;
          });
        } else {
          Object.assign(headers, init.headers);
        }
      }

      let body: string | undefined = undefined;
      if (init?.body) {
        if (typeof init.body === "string") {
          body = init.body;
        } else if (init.body instanceof Blob) {
          body = await init.body.text();
        } else {
          body = String(init.body);
        }
      }

      const res = await invoke<NativeHttpResponse>("native_http_request", {
        url,
        method,
        headers: Object.keys(headers).length > 0 ? headers : null,
        body: body ?? null,
      });

      return new Response(res.body, {
        status: res.status,
        statusText: res.status_text,
        headers: new Headers(res.headers),
      });
    } catch (nativeErr) {
      console.warn("[apiFetch] Native HTTP request failed, falling back to window.fetch:", nativeErr);
    }
  }

  return window.fetch(url, init);
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  // Prepare headers
  const reqInit: RequestInit = { ...init };
  const headers = new Headers(reqInit.headers || {});

  // Auto-inject Authorization header if not present
  if (!headers.has("Authorization") && !headers.has("authorization")) {
    const token = activeTokenGetter ? activeTokenGetter() : (typeof localStorage !== "undefined" ? localStorage.getItem("opinion_jwt_token") : null);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }
  reqInit.headers = headers;

  const res = await performFetch(url, reqInit);

  // Check for 401 token expiration (exclude auth endpoints to prevent recursion)
  const isAuthEndpoint = url.includes("/auth/login") || url.includes("/auth/refresh") || url.includes("/auth/auto-fix") || url.includes("/auth/logout");

  if (res.status === 401 && !isAuthEndpoint && activeTokenRefresher) {
    console.info("[apiFetch] 401 Unauthorized received. Attempting silent token refresh...");
    const refreshed = await activeTokenRefresher();

    if (refreshed) {
      const newToken = activeTokenGetter ? activeTokenGetter() : null;
      if (newToken) {
        headers.set("Authorization", `Bearer ${newToken}`);
        reqInit.headers = headers;
        console.info("[apiFetch] Silent token refresh succeeded. Retrying original request...");
        return performFetch(url, reqInit);
      }
    }
  }

  return res;
}
