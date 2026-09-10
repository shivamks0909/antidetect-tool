import { safeInvoke } from "../../../shared/lib/tauriHelper";
import type { ProfileMeta } from "./types";

const MOCK_PROFILES_KEY = "oi_mock_profiles";

function getMockProfiles(): any[] {
  try {
    const raw = localStorage.getItem(MOCK_PROFILES_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveMockProfiles(list: any[]) {
  try {
    localStorage.setItem(MOCK_PROFILES_KEY, JSON.stringify(list));
  } catch {}
}

const mockProfileList = (): ProfileMeta[] => {
  const list = getMockProfiles();
  return list.map((p) => {
    const id = String(p._meta?.id || p.id || `prof-${Date.now()}`);
    return {
      id,
      owner_account_id: p._meta?.owner_account_id || p.owner_account_id || "",
      name: String(p.name || "Untitled Profile"),
      notes: String(p.notes || ""),
      proxy_id: p._meta?.proxy_id || p.proxy_id || null,
      last_launched_at: p._meta?.last_launched_at || p.last_launched_at || null,
      created_at: p.created_at ? String(p.created_at) : new Date().toISOString(),
      updated_at: p.updated_at ? String(p.updated_at) : null,
      pinned: Boolean(p.pinned),
      folder: String(p.folder || ""),
      total_runtime_ms: Number(p.total_runtime_ms || 0),
      color: p._meta?.color || p.color || null,
      extensions: Array.isArray(p._meta?.extensions) ? p._meta.extensions : (Array.isArray(p.extensions) ? p.extensions : []),
    };
  });
};

const mockProfileGet = (id: string): any => {
  const list = getMockProfiles();
  return list.find((p) => (p._meta?.id || p.id) === id) || null;
};

const mockProfileSave = (payload: any): ProfileMeta => {
  const list = getMockProfiles();
  const rawId = payload._meta?.id || payload.id;
  const id = rawId && rawId.trim() !== "" ? rawId : `prof-${Date.now()}`;
  const now = new Date().toISOString();

  const storedObj = payload._meta
    ? { ...payload, _meta: { ...payload._meta, id } }
    : {
        _meta: {
          id,
          proxy_id: payload.proxy_id || null,
          last_launched_at: payload.last_launched_at || null,
          gpu_preset_id: payload.gpu_preset_id || "",
          color: payload.color || null,
          extensions: payload.extensions || [],
        },
        name: payload.name || "Untitled Profile",
        notes: payload.notes || "",
        created_at: payload.created_at || now,
        pinned: Boolean(payload.pinned),
        folder: payload.folder || "",
        total_runtime_ms: payload.total_runtime_ms || 0,
      };

  const meta: ProfileMeta = {
    id,
    owner_account_id: storedObj._meta?.owner_account_id || storedObj.owner_account_id || "",
    name: storedObj.name || "Untitled Profile",
    notes: storedObj.notes || "",
    proxy_id: storedObj._meta?.proxy_id || null,
    last_launched_at: storedObj._meta?.last_launched_at || null,
    created_at: storedObj.created_at || now,
    updated_at: storedObj.updated_at || now,
    pinned: Boolean(storedObj.pinned),
    folder: storedObj.folder || "",
    total_runtime_ms: storedObj.total_runtime_ms || 0,
    color: storedObj._meta?.color || null,
    extensions: storedObj._meta?.extensions || [],
  };

  const idx = list.findIndex((p) => (p._meta?.id || p.id) === id);
  if (idx >= 0) {
    list[idx] = storedObj;
  } else {
    list.push(storedObj);
  }
  saveMockProfiles(list);
  return meta;
};

const mockProfileDelete = (id: string): boolean => {
  const list = getMockProfiles();
  saveMockProfiles(list.filter((p) => (p._meta?.id || p.id) !== id));
  return true;
};

export const profileList = () => safeInvoke<ProfileMeta[]>("profile_list", undefined, mockProfileList);
export const profileGet = (id: string) => safeInvoke<any>("profile_get", { id }, () => mockProfileGet(id));
export const profileSave = async (payload: any): Promise<ProfileMeta> => {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    const meta = await invoke<ProfileMeta>("profile_save", { payload });
    mockProfileSave({ ...payload, _meta: { ...(payload._meta || {}), id: meta.id } });
    return meta;
  }
  return mockProfileSave(payload);
};
export const profileDelete = (id: string) => safeInvoke("profile_delete", { id }, () => mockProfileDelete(id));
export const profileClone = (id: string) => safeInvoke<ProfileMeta>("profile_clone", { id }, () => {
  const orig = mockProfileGet(id);
  if (!orig) throw new Error("Profile not found");
  return mockProfileSave({ ...orig, id: undefined, name: `${orig.name} (Copy)` });
});
export const profileSetPin = (id: string, pinned: boolean) => safeInvoke("profile_set_pin", { id, pinned }, () => {
  const p = mockProfileGet(id);
  if (p) mockProfileSave({ ...p, pinned });
});
export const profileSetFolder = (id: string, folder: string) => safeInvoke("profile_set_folder", { id, folder }, () => {
  const p = mockProfileGet(id);
  if (p) mockProfileSave({ ...p, folder });
});
export const profileBindProxy = (profileId: string, proxyId: string | null) => safeInvoke("profile_bind_proxy", { profileId, proxyId }, () => {
  const p = mockProfileGet(profileId);
  if (p) mockProfileSave({ ...p, proxy_id: proxyId });
});
export const profileImport = (payloads: any[]) => safeInvoke<number>("profile_import", { payloads }, () => {
  let count = 0;
  for (const p of payloads) {
    mockProfileSave(p);
    count++;
  }
  return count;
});
export const profileCreateFromTemplate = (templateId: string) => safeInvoke<ProfileMeta>("profile_create_from_template", { templateId }, () => {
  return mockProfileSave({ name: `Template ${templateId}` });
});
export const processList = () => safeInvoke<{ profile_id: string; pid: number; uptime_ms: number }[]>("process_list", undefined, []);
export const processKill = (profileId: string) => safeInvoke<boolean>("process_kill", { profileId }, false);

export const launch = async (profileId: string): Promise<number> => {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<number>("launch", { profileId });
  }
  throw new Error("Browser launch requires running inside Opinion Insights Browser desktop application.");
};

export const syncLaunch = (profileIds: string[], group?: string) =>
  safeInvoke<string>("sync_launch", { profileIds, group }, group || "sync-group");

export type SyncMember = { profile: string; excluded: boolean; driving: boolean };
export type SyncStatus = { group: string; members: SyncMember[]; paused: boolean };
export type SyncLayout = "row" | "grid" | "cascade";

export const syncStatus = (group: string) => safeInvoke<SyncStatus>("sync_status", { group }, { group, members: [], paused: false });
export const syncSetPaused = (group: string, paused: boolean) =>
  safeInvoke<void>("sync_set_paused", { group, paused });
export const syncArrange = (group: string, layout: SyncLayout) =>
  safeInvoke<void>("sync_arrange", { group, layout });
export const syncStop = (group: string) => safeInvoke<void>("sync_stop", { group });
export const syncSetExcluded = (group: string, profile: string, excluded: boolean) =>
  safeInvoke<void>("sync_set_excluded", { group, profile, excluded });
export const syncClosePanel = () => safeInvoke<void>("sync_close_panel");

export type HelperField = { kind: string; select: boolean; x: number; y: number };
export type HelperReport = { fields: HelperField[] } | null;

export const helperProfiles = () => safeInvoke<string[]>("helper_profiles", undefined, []);
export const helperFields = (profile: string) => safeInvoke<HelperReport>("helper_fields", { profile }, null);
export const helperFill = (profile: string) => safeInvoke<number>("helper_fill", { profile }, 0);
export const helperShow = (profile: string) => safeInvoke<void>("helper_show", { profile });
export const helperClose = () => safeInvoke<void>("helper_close");
export const helperDismiss = (profile: string) => safeInvoke<void>("helper_dismiss", { profile });
export const folderDelete = (folder: string, deleteProfiles: boolean) => safeInvoke<number>("folder_delete", { folder, deleteProfiles }, 0);
export const cookiesExportToFile = (profileId: string, path: string) => safeInvoke<number>("cookies_export_to_file", { profileId, path }, 0);
export const cookiesImport = (profileId: string, cookies: any[]) => safeInvoke<number>("cookies_import", { profileId, cookies }, 0);
export const enrichPicksForPreset = (presetId: string) => safeInvoke<{ hardware_concurrency?: number; device_memory?: number; platform_version?: string }>("enrich_picks_for_preset", { presetId }, {});
export const hostPlatform = () => safeInvoke<string>("host_platform", undefined, "windows");
