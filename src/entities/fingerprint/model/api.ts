import { safeInvoke } from "../../../shared/lib/tauriHelper";
import type { FingerprintEntry } from "./types";

const mockFp: FingerprintEntry = {
  id: "fp-mock",
  label: "Mock Fingerprint",
  platform: "Windows",
  chrome: "152.0.0.0",
  gpu: "NVIDIA GeForce RTX 4090",
  tag_color: "#3b82f6",
  builtin: true,
  payload: {},
};

export const fingerprintList = () => safeInvoke<FingerprintEntry[]>("fingerprint_list", undefined, []);
export const fingerprintDelete = (id: string) => safeInvoke("fingerprint_delete", { id });
export const fingerprintImport = (jsonText: string, idHint: string | null) => safeInvoke<FingerprintEntry>("fingerprint_import", { jsonText, idHint }, () => ({
  ...mockFp,
  id: idHint || `fp-${Date.now()}`,
}));
export const fingerprintDir = () => safeInvoke<string>("fingerprint_dir", undefined, "");
