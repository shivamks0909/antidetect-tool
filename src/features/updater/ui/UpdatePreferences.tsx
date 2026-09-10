import React from 'react';
import { useUpdaterStore } from '../model/useUpdaterStore';

const INTERVAL_OPTIONS = [
  { label: 'Every 1 hour', value: 1 },
  { label: 'Every 3 hours', value: 3 },
  { label: 'Every 6 hours', value: 6 },
  { label: 'Every 12 hours', value: 12 },
  { label: 'Every 24 hours', value: 24 },
];

export const UpdatePreferences: React.FC = () => {
  const {
    preferences,
    setPreferences,
    checkForUpdates,
    status,
    updateInfo,
    lastCheckedAt,
    openModal,
  } = useUpdaterStore();

  const isChecking = status === 'checking';
  const hasUpdate = status === 'available' || status === 'ready-to-restart';

  const handleCheckNow = async () => {
    if (hasUpdate) {
      openModal();
    } else {
      await checkForUpdates(false);
      openModal();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Application Updates</h3>
          <p className="text-xs text-slate-400 mt-1">
            Configure how the app handles updates and new versions.
          </p>
        </div>
        <button
          onClick={handleCheckNow}
          disabled={isChecking}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-800/80 border border-slate-700/80 text-white rounded-xl text-xs font-medium transition-all shadow-sm flex items-center gap-2 disabled:opacity-50"
        >
          {isChecking ? (
            <>
              <svg className="w-3.5 h-3.5 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>Checking...</span>
            </>
          ) : hasUpdate ? (
            <>
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
              <span className="text-blue-400 font-semibold">Update Available</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Check for Updates</span>
            </>
          )}
        </button>
      </div>

      {/* Preferences Grid */}
      <div className="space-y-4">
        {/* Auto Check Toggle */}
        <div className="flex items-center justify-between p-4 bg-slate-950/40 border border-slate-800 rounded-xl">
          <div>
            <div className="text-xs font-medium text-white">Check for updates automatically</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Periodically check GitHub for new versions in the background.
            </div>
          </div>
          <button
            onClick={() => setPreferences({ autoCheck: !preferences.autoCheck })}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              preferences.autoCheck ? 'bg-blue-500' : 'bg-slate-700'
            }`}
          >
            <div
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                preferences.autoCheck ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>

        {/* Check Interval (only when autoCheck is on) */}
        {preferences.autoCheck && (
          <div className="flex items-center justify-between p-4 bg-slate-950/40 border border-slate-800 rounded-xl ml-4">
            <div>
              <div className="text-xs font-medium text-white">Check interval</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                How often to check for updates.
              </div>
            </div>
            <select
              value={preferences.checkIntervalHours}
              onChange={(e) => setPreferences({ checkIntervalHours: Number(e.target.value) })}
              className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Auto Download Toggle */}
        <div className="flex items-center justify-between p-4 bg-slate-950/40 border border-slate-800 rounded-xl">
          <div>
            <div className="text-xs font-medium text-white">Download updates automatically</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Automatically download updates when found (no installation until you approve).
            </div>
          </div>
          <button
            onClick={() => setPreferences({ autoDownload: !preferences.autoDownload })}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              preferences.autoDownload ? 'bg-blue-500' : 'bg-slate-700'
            }`}
          >
            <div
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                preferences.autoDownload ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>

        {/* Auto Install Toggle */}
        <div className="flex items-center justify-between p-4 bg-slate-950/40 border border-slate-800 rounded-xl">
          <div>
            <div className="text-xs font-medium text-white">Install updates automatically</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Automatically restart the app to apply updates after download completes.
            </div>
            {!preferences.autoInstall && (
              <div className="text-[11px] text-amber-400/80 mt-1">
                When disabled, you'll be prompted to restart manually after download.
              </div>
            )}
          </div>
          <button
            onClick={() => setPreferences({ autoInstall: !preferences.autoInstall })}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              preferences.autoInstall ? 'bg-blue-500' : 'bg-slate-700'
            }`}
          >
            <div
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                preferences.autoInstall ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>
      </div>

      {/* Status Info */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
        <div className="text-[11px] text-slate-500">
          {updateInfo
            ? `Latest: v${updateInfo.version}`
            : 'No update data yet'}
        </div>
        {lastCheckedAt && (
          <div className="text-[11px] text-slate-500">
            Last checked: {lastCheckedAt}
          </div>
        )}
      </div>
    </div>
  );
};
