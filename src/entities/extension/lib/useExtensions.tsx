import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "../../../shared/lib/toast";
import { confirmModal } from "../../../shared/lib/confirm";
import { storeBus } from "../../../shared/lib/storeBus";
import {
  extensionDelete,
  extensionImport,
  extensionImportUrl,
  extensionList,
  extensionSetDelete,
  extensionSetList,
  extensionSetSave,
} from "../model/api";
import type { ExtensionEntry, ExtensionSet } from "../model/types";

export type ExtensionStore = {
  status: "idle" | "loading" | "ready" | "error";
  items: ExtensionEntry[];
  extensionSets: ExtensionSet[];
  busy: boolean;
  search: string;
  /// The "paste a link" dialog.
  linkOpen: boolean;

  init: () => Promise<void>;
  reload: () => Promise<void>;
  loadSets: () => Promise<void>;
  saveSet: (set: Omit<ExtensionSet, "id" | "created_at"> & { id?: string; created_at?: string }) => Promise<ExtensionSet>;
  deleteSet: (id: string) => Promise<void>;
  setSearch: (q: string) => void;
  setLinkOpen: (open: boolean) => void;
  importUrl: (url: string) => Promise<void>;
  importFiles: () => Promise<void>;
  importFolder: () => Promise<void>;
  remove: (e: ExtensionEntry) => Promise<void>;
  reset: () => void;
};

export const useExtensions = create<ExtensionStore>((set, get) => ({
  status: "idle",
  items: [],
  extensionSets: [],
  busy: false,
  search: "",
  linkOpen: false,

  reset: () => {
    set({
      status: "idle",
      items: [],
      extensionSets: [],
      busy: false,
      search: "",
      linkOpen: false,
    });
  },

  loadSets: async () => {
    try {
      const sets = await extensionSetList();
      set({ extensionSets: sets });
    } catch (err) {
      console.warn("[useExtensions] Failed to load extension sets:", err);
    }
  },

  saveSet: async (setData) => {
    const saved = await extensionSetSave(setData);
    await get().loadSets();
    toast.ok(`Saved extension set "${saved.name}"`);
    return saved;
  },

  deleteSet: async (id) => {
    await extensionSetDelete(id);
    await get().loadSets();
    toast.ok("Extension set deleted");
  },

  init: async () => {
    if (get().status === "loading" || get().status === "ready") return;
    set({ status: "loading" });
    try {
      const [items, sets] = await Promise.all([
        extensionList(),
        extensionSetList().catch(() => []),
      ]);
      set({ items, extensionSets: sets, status: "ready" });
    } catch (e) {
      set({ status: "error" });
      toast.err(String(e));
    }
  },
  reload: async () => {
    try {
      const [items, sets] = await Promise.all([
        extensionList(),
        extensionSetList().catch(() => get().extensionSets),
      ]);
      set({ items, extensionSets: sets });
      storeBus.emit("extensions");
    } catch (e) { toast.err(String(e)); }
  },
  setSearch: (search) => set({ search }),
  setLinkOpen: (linkOpen) => set({ linkOpen }),

  importUrl: async (url) => {
    if (!url.trim()) return;
    set({ busy: true });
    try {
      const added = await extensionImportUrl(url.trim());
      await get().reload();
      set({ linkOpen: false });
      toast.ok(`Added "${added.name}"`);
    } catch (e) { toast.err("Download failed: " + String(e)); }
    finally { set({ busy: false }); }
  },

  importFiles: async () => {
    const picked = await open({
      multiple: true,
      title: "Pick .crx or .zip extensions",
      filters: [{ name: "Extension", extensions: ["crx", "zip"] }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length === 0) return;
    set({ busy: true });
    try {
      const added = await extensionImport(paths as string[]);
      await get().reload();
      toast.ok(`Added ${added.length} extension${added.length === 1 ? "" : "s"}`);
    } catch (e) { toast.err("Import failed: " + String(e)); }
    finally { set({ busy: false }); }
  },

  importFolder: async () => {
    const dir = await open({ directory: true, title: "Pick an unpacked extension folder" });
    if (typeof dir !== "string") return;
    set({ busy: true });
    try {
      const added = await extensionImport([dir]);
      await get().reload();
      toast.ok(added.length > 0 ? `Added "${added[0].name}"` : "Nothing added");
    } catch (e) { toast.err("Import failed: " + String(e)); }
    finally { set({ busy: false }); }
  },

  remove: async (e) => {
    const ok = await confirmModal({
      title: "Remove extension",
      message: `Remove "${e.name}" from the library? Profiles using it stop loading it on their next launch.`,
      danger: true,
    });
    if (ok !== true) return;
    try {
      await extensionDelete(e.id);
      await get().reload();
      toast.ok("Extension removed");
    } catch (err) { toast.err(String(err)); }
  },
}));
