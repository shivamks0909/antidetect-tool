import { useEffect, useMemo, useState } from "react";
import { Button, DialogModal } from "@proxyshard/shardx-ui-kit";
import { Topbar } from "../../shared/ui/Topbar";
import { useStoreChanged } from "../../shared/hooks/useStoreChanged";
import { AddIcon, DeleteIcon, FolderIcon, GlobeIcon, NavExtensionsIcon } from "../../shared/icons";
import { Field } from "../../shared/ui/Field";
import { useExtensions, type ExtensionEntry, type ExtensionSet } from "../../entities/extension";
import { fmtBytes } from "../../shared/lib/utils";
import { confirmModal } from "../../shared/lib/confirm";
import { toast } from "../../shared/lib/toast";

function Card({ e }: { e: ExtensionEntry }) {
  const remove = useExtensions((s) => s.remove);
  return (
    <article className="flex flex-col gap-2.5 rounded-xl bg-bg-white-0 p-3.5 ring-1 ring-inset ring-stroke-soft-200">
      <div className="flex items-start gap-2.5">
        {e.icon ? (
          <img src={e.icon} alt="" className="size-10 shrink-0 rounded-lg object-contain" />
        ) : (
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-alpha-10 text-primary-base">
            <NavExtensionsIcon className="size-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate text-label-xs text-text-strong-950" title={e.name}>{e.name}</h3>
          <div className="mt-0.5 flex items-center gap-1.5 text-paragraph-xs text-text-soft-400">
            {e.version && <span>v{e.version}</span>}
            <span>·</span>
            <span>{fmtBytes(e.size_bytes)}</span>
          </div>
        </div>
      </div>
      <p className="m-0 line-clamp-3 min-h-[2.4em] text-paragraph-xs text-text-sub-600">
        {e.description || <span className="text-text-soft-400">No description in the manifest.</span>}
      </p>
      <div className="flex justify-end">
        <Button
          variant="error"
          mode="ghost"
          size="2xsmall"
          leftIcon={<DeleteIcon className="size-3.5" />}
          onClick={() => remove(e)}
        >
          Remove
        </Button>
      </div>
    </article>
  );
}

function ExtensionSetCard({
  set,
  onEdit,
}: {
  set: ExtensionSet;
  onEdit: () => void;
}) {
  const deleteSet = useExtensions((s) => s.deleteSet);
  const items = useExtensions((s) => s.items);

  const handleDelete = async () => {
    const ok = await confirmModal({
      title: "Delete Extension Set",
      message: `Delete "${set.name}"? Profiles already using these extensions will not be affected.`,
      danger: true,
    });
    if (ok) {
      await deleteSet(set.id);
    }
  };

  return (
    <article className="flex flex-col justify-between gap-3 rounded-xl bg-bg-white-0 p-3.5 ring-1 ring-inset ring-stroke-soft-200">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="m-0 truncate text-label-sm text-text-strong-950" title={set.name}>
              {set.name}
            </h3>
            <span className="text-paragraph-xs text-text-soft-400">
              {set.extension_ids.length} extension{set.extension_ids.length === 1 ? "" : "s"}
            </span>
          </div>
          <span className="rounded bg-primary-alpha-10 px-2 py-0.5 text-[10px] font-semibold text-primary-base">
            Set
          </span>
        </div>

        {set.description ? (
          <p className="m-0 line-clamp-2 text-paragraph-xs text-text-sub-600">
            {set.description}
          </p>
        ) : (
          <p className="m-0 text-paragraph-xs text-text-soft-400 italic">No description</p>
        )}

        <div className="flex flex-wrap gap-1 pt-1 max-h-20 overflow-y-auto">
          {set.extension_ids.map((id) => {
            const ext = items.find((e) => e.id === id);
            return (
              <span
                key={id}
                title={ext?.name || id}
                className="inline-flex items-center gap-1 rounded bg-bg-weak-50 px-1.5 py-0.5 text-[10.5px] text-text-sub-600 ring-1 ring-inset ring-stroke-soft-200"
              >
                <NavExtensionsIcon className="size-2.5 text-primary-base shrink-0" />
                <span className="truncate max-w-[90px]">{ext?.name || id}</span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-stroke-soft-200/60 pt-2.5">
        <Button variant="neutral" mode="stroke" size="2xsmall" onClick={onEdit}>
          Edit Set
        </Button>
        <Button
          variant="error"
          mode="ghost"
          size="2xsmall"
          leftIcon={<DeleteIcon className="size-3.5" />}
          onClick={handleDelete}
        >
          Delete
        </Button>
      </div>
    </article>
  );
}

function ExtensionSetModal({
  editingSet,
  onClose,
}: {
  editingSet?: ExtensionSet | null;
  onClose: () => void;
}) {
  const saveSet = useExtensions((s) => s.saveSet);
  const items = useExtensions((s) => s.items);
  const [name, setName] = useState(editingSet?.name || "");
  const [desc, setDesc] = useState(editingSet?.description || "");
  const [selectedIds, setSelectedIds] = useState<string[]>(editingSet?.extension_ids || []);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.err("Please enter a name for the extension set");
      return;
    }
    setLoading(true);
    try {
      await saveSet({
        id: editingSet?.id,
        name: name.trim(),
        description: desc.trim(),
        extension_ids: selectedIds,
        created_at: editingSet?.created_at,
      });
      onClose();
    } catch (err: any) {
      toast.err(err?.message || "Failed to save extension set");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogModal
      open
      onClose={onClose}
      title={editingSet ? "Edit Extension Set" : "Create Extension Set"}
      confirmLabel={loading ? "Saving…" : "Save Extension Set"}
      onConfirm={handleSave}
      isLoading={loading}
      isDisabled={loading || !name.trim()}
      cancelLabel="Cancel"
      onCancel={onClose}
    >
      <div className="flex w-[480px] flex-col gap-3 py-3 text-xs">
        <div>
          <label className="block font-medium text-text-main mb-1">Set Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Research Fleet, Crypto Wallets"
            className="w-full rounded-md border border-border-soft-200 bg-bg-surface px-3 py-1.5 text-xs text-text-main focus:border-primary-base focus:outline-none"
          />
        </div>
        <div>
          <label className="block font-medium text-text-main mb-1">Description</label>
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="What is this extension set used for?"
            className="w-full rounded-md border border-border-soft-200 bg-bg-surface px-3 py-1.5 text-xs text-text-main focus:border-primary-base focus:outline-none"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="font-medium text-text-main">
              Select Extensions ({selectedIds.length} selected)
            </label>
            <div className="flex gap-2 text-[11px]">
              <button
                type="button"
                className="text-primary-base hover:underline"
                onClick={() => setSelectedIds(items.map((e) => e.id))}
              >
                Select All
              </button>
              <span className="text-text-muted">·</span>
              <button
                type="button"
                className="text-text-muted hover:underline"
                onClick={() => setSelectedIds([])}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="max-h-44 overflow-y-auto divide-y divide-border-soft-200 rounded border border-border-soft-200">
            {items.map((ext) => {
              const isChecked = selectedIds.includes(ext.id);
              return (
                <label
                  key={ext.id}
                  className={`flex cursor-pointer items-center gap-2.5 p-2 transition-colors ${
                    isChecked ? "bg-primary-base/5" : "hover:bg-bg-soft-100/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => {
                      setSelectedIds((prev) =>
                        e.target.checked ? [...prev, ext.id] : prev.filter((id) => id !== ext.id)
                      );
                    }}
                    className="rounded border-border-soft-200 text-primary-base focus:ring-primary-base"
                  />
                  {ext.icon ? (
                    <img src={ext.icon} alt="" className="size-5 rounded object-contain shrink-0" />
                  ) : (
                    <div className="grid size-5 shrink-0 place-items-center rounded bg-primary-base/10 text-primary-base text-[9px] font-bold">
                      {ext.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className="text-xs font-medium text-text-main truncate flex-1">{ext.name}</span>
                  {ext.version && (
                    <span className="text-[10px] text-text-muted font-mono">v{ext.version}</span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </DialogModal>
  );
}

/** Add by address: a Web Store page, a bare id, or a .crx / .zip link. */
function LinkDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const busy = useExtensions((s) => s.busy);
  const importUrl = useExtensions((s) => s.importUrl);
  return (
    <DialogModal
      open
      onClose={onClose}
      title="Add from a link"
      confirmLabel={busy ? "Downloading…" : "Download"}
      onConfirm={() => importUrl(url)}
      isLoading={busy}
      isDisabled={busy || !url.trim()}
      cancelLabel="Cancel"
      onCancel={onClose}
    >
      <div className="flex w-[460px] flex-col gap-3 py-4">
        <Field
          label="Web Store page, extension id, or a .crx / .zip link"
          value={url}
          onChange={setUrl}
          placeholder="https://chromewebstore.google.com/detail/…"
          mono
        />
        <p className="m-0 text-paragraph-xs text-text-soft-400">
          A Web Store page is not the file itself, so the id is taken out of the
          address and the extension fetched by it. Pasting just the id works too.
        </p>
      </div>
    </DialogModal>
  );
}

export function ExtensionsPage() {
  const init = useExtensions((s) => s.init);
  const items = useExtensions((s) => s.items);
  const extensionSets = useExtensions((s) => s.extensionSets);
  const busy = useExtensions((s) => s.busy);
  const search = useExtensions((s) => s.search);
  const setSearch = useExtensions((s) => s.setSearch);
  const importFiles = useExtensions((s) => s.importFiles);
  const importFolder = useExtensions((s) => s.importFolder);
  const linkOpen = useExtensions((s) => s.linkOpen);
  const setLinkOpen = useExtensions((s) => s.setLinkOpen);

  const [activeTab, setActiveTab] = useState<"library" | "sets">("library");
  const [setModalOpen, setSetModalOpen] = useState(false);
  const [editingSet, setEditingSet] = useState<ExtensionSet | null>(null);

  const reload = useExtensions((s) => s.reload);
  useEffect(() => { init(); }, [init]);
  useStoreChanged(reload);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
    );
  }, [items, search]);

  const shownSets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return extensionSets;
    return extensionSets.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q),
    );
  }, [extensionSets, search]);

  return (
    <section className="flex flex-col">
      <Topbar crumbs={["Library", "Extensions"]} search={search} onSearch={setSearch} />

      <div className="mb-3.5 flex items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-title-h5 text-text-strong-950">Extensions</h1>
          <p className="m-0 mt-1 max-w-[70ch] text-paragraph-xs text-text-soft-400">
            Add extensions from a link or file, manage Extension Sets for batch provisioning,
            or attach them per-profile in the profile editor.
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {activeTab === "library" ? (
            <>
              <Button
                variant="neutral" mode="stroke" size="small" disabled={busy}
                leftIcon={<FolderIcon className="size-4" />}
                onClick={importFolder}
              >
                Unpacked folder
              </Button>
              <Button
                variant="neutral" mode="stroke" size="small" disabled={busy}
                leftIcon={<GlobeIcon className="size-4" />}
                onClick={() => setLinkOpen(true)}
              >
                From link
              </Button>
              <Button
                variant="primary" mode="filled" size="small" disabled={busy} isLoading={busy}
                leftIcon={<AddIcon className="size-4" />}
                onClick={importFiles}
              >
                Add .crx / .zip
              </Button>
            </>
          ) : (
            <Button
              variant="primary" mode="filled" size="small"
              leftIcon={<AddIcon className="size-4" />}
              onClick={() => {
                setEditingSet(null);
                setSetModalOpen(true);
              }}
            >
              New Extension Set
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex items-center gap-2 border-b border-stroke-soft-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("library")}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-label-xs transition-colors ${
            activeTab === "library"
              ? "bg-bg-weak-50 text-text-strong-950 font-semibold"
              : "text-text-soft-400 hover:text-text-main"
          }`}
        >
          <NavExtensionsIcon className="size-3.5" />
          <span>Installed Extensions ({items.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("sets")}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-label-xs transition-colors ${
            activeTab === "sets"
              ? "bg-bg-weak-50 text-text-strong-950 font-semibold"
              : "text-text-soft-400 hover:text-text-main"
          }`}
        >
          <span>Extension Sets ({extensionSets.length})</span>
        </button>
      </div>

      {activeTab === "library" ? (
        shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 rounded-lg bg-bg-white-0 px-6 py-14 text-center ring-1 ring-inset ring-stroke-soft-200">
            <div className="grid size-14 place-items-center rounded-[14px] bg-primary-alpha-10 text-primary-base ring-1 ring-inset ring-primary-alpha-24">
              <NavExtensionsIcon className="size-6" />
            </div>
            <h3 className="m-0 text-label-sm text-text-strong-950">
              {items.length === 0 ? "No extensions yet" : "Nothing matches that"}
            </h3>
            <p className="m-0 max-w-[420px] text-paragraph-sm text-text-sub-600">
              Paste a Web Store link and it downloads itself, or add a .crx, a .zip
              or a folder you unpacked yourself.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5 pb-6">
            {shown.map((e) => <Card key={e.id} e={e} />)}
          </div>
        )
      ) : (
        shownSets.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 rounded-lg bg-bg-white-0 px-6 py-14 text-center ring-1 ring-inset ring-stroke-soft-200">
            <div className="grid size-14 place-items-center rounded-[14px] bg-primary-alpha-10 text-primary-base ring-1 ring-inset ring-primary-alpha-24">
              <NavExtensionsIcon className="size-6" />
            </div>
            <h3 className="m-0 text-label-sm text-text-strong-950">
              {extensionSets.length === 0 ? "No Extension Sets yet" : "No matching Extension Sets"}
            </h3>
            <p className="m-0 max-w-[420px] text-paragraph-sm text-text-sub-600">
              Extension Sets group multiple extensions together (e.g. MetaMask + Cookiebro) so you can
              apply them to hundreds of profiles during Batch Import with one click.
            </p>
            <Button
              variant="primary"
              mode="filled"
              size="small"
              className="mt-2"
              leftIcon={<AddIcon className="size-4" />}
              onClick={() => {
                setEditingSet(null);
                setSetModalOpen(true);
              }}
            >
              Create Extension Set
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 pb-6">
            {shownSets.map((s) => (
              <ExtensionSetCard
                key={s.id}
                set={s}
                onEdit={() => {
                  setEditingSet(s);
                  setSetModalOpen(true);
                }}
              />
            ))}
          </div>
        )
      )}

      {linkOpen && <LinkDialog onClose={() => setLinkOpen(false)} />}
      {setModalOpen && (
        <ExtensionSetModal
          editingSet={editingSet}
          onClose={() => {
            setSetModalOpen(false);
            setEditingSet(null);
          }}
        />
      )}
    </section>
  );
}
