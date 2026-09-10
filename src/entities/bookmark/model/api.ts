import { safeInvoke } from "../../../shared/lib/tauriHelper";
import type { Bookmark } from "./types";

const MOCK_BOOKMARKS_KEY = "oi_mock_bookmarks";

function getMockBookmarks(): Bookmark[] {
  try { return JSON.parse(localStorage.getItem(MOCK_BOOKMARKS_KEY) || "[]"); }
  catch { return []; }
}
function saveMockBookmarks(list: Bookmark[]) {
  try { localStorage.setItem(MOCK_BOOKMARKS_KEY, JSON.stringify(list)); } catch {}
}

const mockBookmarkSave = (entry: Bookmark): Bookmark => {
  const list = getMockBookmarks();
  const id = entry.id || `bm-${Date.now()}`;
  const full = { ...entry, id };
  const idx = list.findIndex((b) => b.id === id);
  if (idx >= 0) list[idx] = full; else list.push(full);
  saveMockBookmarks(list);
  return full;
};

export const bookmarkList = () => safeInvoke<Bookmark[]>("bookmark_list", undefined, getMockBookmarks);
export const bookmarkSave = (entry: Bookmark) => safeInvoke<Bookmark>("bookmark_save", { entry }, () => mockBookmarkSave(entry));
export const bookmarkDelete = (id: string) => safeInvoke("bookmark_delete", { id }, () => saveMockBookmarks(getMockBookmarks().filter((b) => b.id !== id)));
