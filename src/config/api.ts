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

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

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

  return window.fetch(input, init);
}
