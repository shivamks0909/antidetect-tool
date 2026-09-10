import { safeInvoke } from "../../../shared/lib/tauriHelper";
import type { ProfileMeta } from "../../profile/model/types";
import type { TrashEntry } from "./types";

const mockMeta: ProfileMeta = {
  id: "restored-profile",
  name: "Restored Profile",
  notes: "",
  proxy_id: null,
  last_launched_at: null,
  created_at: new Date().toISOString(),
  pinned: false,
  folder: "",
  total_runtime_ms: 0,
  color: null,
  extensions: [],
};

export const trashList = () => safeInvoke<TrashEntry[]>("trash_list", undefined, []);
export const trashRestore = (id: string) => safeInvoke<ProfileMeta>("trash_restore", { id }, mockMeta);
export const trashPurge = (id: string) => safeInvoke("trash_purge", { id });
export const trashEmpty = () => safeInvoke<number>("trash_empty", undefined, 0);
