import { safeInvoke } from "../../../shared/lib/tauriHelper";
import { API_BASE, apiFetch } from "../../../config/api";
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

// ---- Extension Sets (Account-Scoped & Synced) ----

function getActiveAccountId(): string {
  try {
    const raw = localStorage.getItem("opinion_user_session");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.user?.id) return parsed.user.id;
    }
  } catch {}
  return "anonymous";
}

function getSetsStorageKey(accountId = getActiveAccountId()): string {
  return `oi_extension_sets_${accountId || "anonymous"}`;
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
  const localList = getLocalExtensionSets(accountId);
  const token = localStorage.getItem("opinion_jwt_token");

  if (!token) return localList;

  try {
    const res = await apiFetch(`${API_BASE}/data/extension-sets`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const remote = await res.json();
      if (Array.isArray(remote)) {
        saveLocalExtensionSets(remote, accountId);
        return remote;
      }
    }
  } catch (err) {
    console.warn("[ExtensionSet] Server fetch failed, using local cache:", err);
  }

  return localList;
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

  const token = localStorage.getItem("opinion_jwt_token");
  if (token) {
    apiFetch(`${API_BASE}/data/extension-sets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(saved),
    }).catch((err) => console.warn("[ExtensionSet] Server sync failed:", err));
  }

  return saved;
}

export async function extensionSetDelete(id: string): Promise<boolean> {
  const accountId = getActiveAccountId();
  const sets = getLocalExtensionSets(accountId);
  const filtered = sets.filter((s) => s.id !== id);
  saveLocalExtensionSets(filtered, accountId);

  const token = localStorage.getItem("opinion_jwt_token");
  if (token) {
    apiFetch(`${API_BASE}/data/extension-sets/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch((err) => console.warn("[ExtensionSet] Server delete sync failed:", err));
  }

  return true;
}
