export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready-to-restart'
  | 'up-to-date'
  | 'error';

export interface UpdatePreferences {
  autoCheck: boolean;
  autoDownload: boolean;
  autoInstall: boolean;
  checkIntervalHours: number;
}

export const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = {
  autoCheck: true,
  autoDownload: true,
  autoInstall: false,
  checkIntervalHours: 6,
};

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export interface UpdateProgress {
  totalBytes: number;
  downloadedBytes: number;
  percent: number;
}

export interface UpdaterState {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  progress: UpdateProgress;
  errorMessage: string | null;
  isOpen: boolean;
  lastCheckedAt: string | null;
  runningProfiles: string[];
  preferences: UpdatePreferences;
  dismissedVersion: string | null;
  checkingLocked: boolean;
  restartCountdown: number | null;

  // Actions
  checkForUpdates: (silent?: boolean) => Promise<void>;
  startDownloadAndInstall: () => Promise<void>;
  relaunchApp: () => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
  dismissUntilNextLaunch: () => void;
  setPreferences: (prefs: Partial<UpdatePreferences>) => void;
  cancelRestartCountdown: () => void;
}
