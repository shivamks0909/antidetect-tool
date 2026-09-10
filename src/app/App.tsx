import { useEffect } from "react";
import { Sidebar } from "../widgets/Sidebar/Sidebar";
import { FirstRunGate } from "../widgets/FirstRunGate/FirstRunGate";
import { ToastHost } from "../widgets/ToastHost/ToastHost";
import { ConfirmHost } from "../widgets/ConfirmHost/ConfirmHost";
import { StarModal } from "../widgets/StarModal/StarModal";
import { HelperWatcher } from "../widgets/HelperWatcher";
import { WhatsNewGate } from "../widgets/WhatsNewGate";
import { BrowsersPage } from "../pages/browsers";
import { ProxiesPage } from "../pages/proxies";
import { FingerprintsPage } from "../pages/fingerprints";
import { ExtensionsPage } from "../pages/extensions";
import { BookmarksPage } from "../pages/bookmarks";
import { TrashPage } from "../pages/trash";
import { SettingsPage } from "../pages/settings";
import { PatchLogPage } from "../pages/patchlog";
import { AdminPage } from "../pages/admin/AdminPage";
import { useNav } from "../shared/model/navigation";
import { trackSection } from "../shared/lib/analytics";
import { UpdateModal, UpdateBanner, usePeriodicUpdateCheck } from "../features/updater";

export function App() {
  const section = useNav((s) => s.section);

  useEffect(() => { void trackSection(section); }, [section]);

  // Periodic update check (handles startup check + interval-based re-checks)
  usePeriodicUpdateCheck();

  return (
    <>
      <UpdateBanner />
      <UpdateModal />
      <HelperWatcher />
      <WhatsNewGate />
      <FirstRunGate>
        <div
          className="grid h-full overflow-hidden bg-bg-weak-50 [grid-template-columns:240px_1fr] [@media(min-width:1700px)]:[grid-template-columns:280px_1fr]"
        >
          <Sidebar />
          <main className="overflow-y-auto px-7 py-6">
            {section === "browsers" && <BrowsersPage />}
            {section === "proxies" && <ProxiesPage />}
            {section === "fingerprints" && <FingerprintsPage />}
            {section === "extensions" && <ExtensionsPage />}
            {section === "bookmarks" && <BookmarksPage />}
            {section === "trash" && <TrashPage />}
            {section === "patchlog" && <PatchLogPage />}
            {section === "settings" && <SettingsPage />}
            {section === "admin" && <AdminPage />}
          </main>
          <ToastHost />
          <ConfirmHost />
          <StarModal />
        </div>
      </FirstRunGate>
    </>
  );
}
