import { invoke } from "@tauri-apps/api/core";

export async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, any>,
  fallback?: T | (() => T | Promise<T>)
): Promise<T> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return await invoke<T>(cmd, args);
  }
  if (typeof fallback === "function") {
    return (fallback as () => T | Promise<T>)();
  }
  return fallback as T;
}
