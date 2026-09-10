import { create } from 'zustand';
import type { UpdaterState, UpdateInfo } from './types';
import { DEFAULT_UPDATE_PREFERENCES, type UpdatePreferences } from './types';

// Hold active update instance across state transitions without polluting serializable store
let activeUpdateHandle: any = null;

const STORAGE_KEY = 'oi_update_preferences';

function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

function loadPreferences(): UpdatePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_UPDATE_PREFERENCES };
    const parsed = JSON.parse(raw);
    return {
      autoCheck: typeof parsed.autoCheck === 'boolean' ? parsed.autoCheck : DEFAULT_UPDATE_PREFERENCES.autoCheck,
      autoDownload: typeof parsed.autoDownload === 'boolean' ? parsed.autoDownload : DEFAULT_UPDATE_PREFERENCES.autoDownload,
      autoInstall: typeof parsed.autoInstall === 'boolean' ? parsed.autoInstall : DEFAULT_UPDATE_PREFERENCES.autoInstall,
      checkIntervalHours: typeof parsed.checkIntervalHours === 'number' && parsed.checkIntervalHours > 0
        ? parsed.checkIntervalHours
        : DEFAULT_UPDATE_PREFERENCES.checkIntervalHours,
    };
  } catch {
    return { ...DEFAULT_UPDATE_PREFERENCES };
  }
}

function savePreferences(prefs: UpdatePreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage quota exceeded or unavailable — silent fail
  }
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: 'idle',
  updateInfo: null,
  progress: {
    totalBytes: 0,
    downloadedBytes: 0,
    percent: 0,
  },
  errorMessage: null,
  isOpen: false,
  lastCheckedAt: null,
  runningProfiles: [],
  preferences: loadPreferences(),
  dismissedVersion: null,
  checkingLocked: false,
  restartCountdown: null,

  setPreferences: (prefs: Partial<UpdatePreferences>) => {
    const current = get().preferences;
    const merged = { ...current, ...prefs };
    savePreferences(merged);
    set({ preferences: merged });
  },

  cancelRestartCountdown: () => {
    set({ restartCountdown: null });
  },

  checkForUpdates: async (silent = false) => {
    // Duplicate check prevention
    if (get().checkingLocked) return;
    set({ checkingLocked: true, status: 'checking', errorMessage: null });

    if (!isTauriEnvironment()) {
      console.log('[Updater] Running in web/browser mode. Tauri updater skipped.');
      set({
        status: 'up-to-date',
        lastCheckedAt: new Date().toLocaleTimeString(),
        checkingLocked: false,
      });
      return;
    }

    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();

      if (update && update.available) {
        activeUpdateHandle = update;

        const info: UpdateInfo = {
          version: update.version,
          currentVersion: update.currentVersion,
          date: update.date,
          body: update.body || 'New features, security updates, and performance improvements.',
        };

        // Check if any browser profiles are currently running
        let running: string[] = [];
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const procs: any[] = await invoke('process_list');
          if (Array.isArray(procs)) {
            running = procs.map((p) => p.profile_id || p.profileId || p.id).filter(Boolean);
          }
        } catch (_) {}

        // Session-level dismiss: if same version dismissed, don't auto-show
        const wasDismissed = get().dismissedVersion === info.version;

        set({
          status: 'available',
          updateInfo: info,
          runningProfiles: running,
          lastCheckedAt: new Date().toLocaleTimeString(),
          checkingLocked: false,
          dismissedVersion: wasDismissed ? get().dismissedVersion : null,
          isOpen: silent ? !wasDismissed : true,
        });

        // Auto-download: if enabled and silent check, start downloading immediately
        const { autoDownload } = get().preferences;
        if (autoDownload && silent && !wasDismissed) {
          set({ isOpen: false });
          get().startDownloadAndInstall();
        }
      } else {
        activeUpdateHandle = null;
        set({
          status: 'up-to-date',
          lastCheckedAt: new Date().toLocaleTimeString(),
          isOpen: silent ? false : get().isOpen,
          checkingLocked: false,
        });
      }
    } catch (err: any) {
      console.error('[Updater] Check failed:', err);
      set({
        status: 'error',
        errorMessage: err?.message || 'Failed to connect to update server.',
        lastCheckedAt: new Date().toLocaleTimeString(),
        checkingLocked: false,
      });
    }
  },

  startDownloadAndInstall: async () => {
    if (!activeUpdateHandle) {
      set({ status: 'error', errorMessage: 'No active update to download.' });
      return;
    }

    set({
      status: 'downloading',
      errorMessage: null,
      progress: { totalBytes: 0, downloadedBytes: 0, percent: 0 },
    });

    try {
      let total = 0;
      let downloaded = 0;

      await activeUpdateHandle.downloadAndInstall((event: any) => {
        if (event.event === 'Started') {
          total = event.data.contentLength || 0;
          set({
            progress: {
              totalBytes: total,
              downloadedBytes: 0,
              percent: 0,
            },
          });
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength || 0;
          const pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
          set({
            progress: {
              totalBytes: total,
              downloadedBytes: downloaded,
              percent: pct,
            },
          });
        } else if (event.event === 'Finished') {
          set({
            status: 'ready-to-restart',
            progress: {
              totalBytes: total,
              downloadedBytes: total,
              percent: 100,
            },
          });
        }
      });

      set({ status: 'ready-to-restart' });

      // Auto-install: if enabled, start countdown and relaunch
      const { autoInstall } = get().preferences;
      if (autoInstall) {
        set({ restartCountdown: 3 });
        const countdownInterval = setInterval(() => {
          const current = get().restartCountdown;
          if (current === null || current <= 1) {
            clearInterval(countdownInterval);
            set({ restartCountdown: null });
            get().relaunchApp();
          } else {
            set({ restartCountdown: current - 1 });
          }
        }, 1000);
      }
    } catch (err: any) {
      console.error('[Updater] Download/install error:', err);
      set({
        status: 'error',
        errorMessage: err?.message || 'Download failed. Please check internet connection and retry.',
      });
    }
  },

  relaunchApp: async () => {
    if (!isTauriEnvironment()) {
      window.location.reload();
      return;
    }

    try {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('kill_all_user_browsers');
      } catch (_) {}

      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err: any) {
      console.error('[Updater] Relaunch failed:', err);
      set({
        status: 'error',
        errorMessage: 'Automatic restart failed. Please restart the app manually to complete the update.',
      });
    }
  },

  openModal: () => set({ isOpen: true, dismissedVersion: null }),
  closeModal: () => set({ isOpen: false }),
  dismissUntilNextLaunch: () => {
    const version = get().updateInfo?.version ?? null;
    set({ isOpen: false, dismissedVersion: version });
  },
}));
