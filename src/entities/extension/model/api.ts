import { safeInvoke } from "../../../shared/lib/tauriHelper";
import type { ExtensionEntry, ExtensionSet } from "./types";

const mockExt: ExtensionEntry = {
  id: "ext-mock",
  name: "Mock Extension",
  version: "1.0.0",
  description: "Mock Extension for local browser testing",
  icon: "",
  path: "",
  size_bytes: 1024,
  added_at: "@1700000000",
};

export const extensionList = () => safeInvoke<ExtensionEntry[]>("extension_list", undefined, []);
export const extensionImport = (paths: string[]) =>
  safeInvoke<ExtensionEntry[]>("extension_import", { paths }, []);
export const extensionImportUrl = (url: string) =>
  safeInvoke<ExtensionEntry>("extension_import_url", { url }, mockExt);
export const extensionDelete = (id: string) => safeInvoke("extension_delete", { id });

// ---- Extension Sets (Account-Scoped & Local) ----

function getActiveAccountId(): string {
  return "default";
}

function getSetsStorageKey(accountId = getActiveAccountId()): string {
  return `oi_extension_sets_${accountId}`;
}

export function getLocalExtensionSets(accountId?: string): ExtensionSet[] {
  try {
    const raw = localStorage.getItem(getSetsStorageKey(accountId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalExtensionSets(sets: ExtensionSet[], accountId?: string): void {
  try {
    localStorage.setItem(getSetsStorageKey(accountId), JSON.stringify(sets));
  } catch (err) {
    console.warn("[ExtensionSet] Failed to save extension sets locally:", err);
  }
}

export async function extensionSetList(): Promise<ExtensionSet[]> {
  const accountId = getActiveAccountId();
  return getLocalExtensionSets(accountId);
}

export async function extensionSetSave(set: Omit<ExtensionSet, "id" | "created_at"> & { id?: string; created_at?: string }): Promise<ExtensionSet> {
  const accountId = getActiveAccountId();
  const sets = getLocalExtensionSets(accountId);
  const now = new Date().toISOString();

  const id = set.id || `set-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const saved: ExtensionSet = {
    id,
    owner_account_id: set.owner_account_id || accountId,
    name: set.name.trim(),
    description: set.description?.trim() || "",
    extension_ids: Array.isArray(set.extension_ids) ? Array.from(new Set(set.extension_ids)) : [],
    created_at: set.created_at || now,
    updated_at: now,
  };

  const idx = sets.findIndex((s) => s.id === id);
  if (idx >= 0) {
    sets[idx] = saved;
  } else {
    sets.push(saved);
  }
  saveLocalExtensionSets(sets, accountId);
  return saved;
}

export async function extensionSetDelete(id: string): Promise<boolean> {
  const accountId = getActiveAccountId();
  const sets = getLocalExtensionSets(accountId);
  const filtered = sets.filter((s) => s.id !== id);
  saveLocalExtensionSets(filtered, accountId);
  return true;
}
