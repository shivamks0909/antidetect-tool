import React from 'react';
import { useUpdaterStore } from '../model/useUpdaterStore';

export const UpdateModal: React.FC = () => {
  const {
    status,
    updateInfo,
    progress,
    errorMessage,
    isOpen,
    runningProfiles,
    restartCountdown,
    startDownloadAndInstall,
    relaunchApp,
    closeModal,
    cancelRestartCountdown,
    checkForUpdates,
  } = useUpdaterStore();

  if (!isOpen) return null;

  const isDownloading = status === 'downloading';
  const isReadyToRestart = status === 'ready-to-restart';
  const isUpToDate = status === 'up-to-date';
  const isChecking = status === 'checking';
  const isError = status === 'error';

  const formatMB = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/80 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header Glow Accent */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />

        {/* Modal Header */}
        <div className="p-6 border-b border-slate-800 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">
                {isUpToDate
                  ? 'App is Up to Date'
                  : isReadyToRestart
                  ? restartCountdown !== null
                    ? `Restarting in ${restartCountdown}...`
                    : 'Update Ready to Install'
                  : isDownloading
                  ? 'Downloading Update...'
                  : 'New Update Available'}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {updateInfo ? (
                  <>
                    Version <span className="text-blue-400 font-mono font-medium">v{updateInfo.version}</span> is available
                    (current: <span className="font-mono text-slate-300">v{updateInfo.currentVersion}</span>)
                  </>
                ) : (
                  'Opinion Insights Antidetect Browser'
                )}
              </p>
            </div>
          </div>

          {!isDownloading && (
            <button
              onClick={closeModal}
              className="text-slate-400 hover:text-slate-200 transition-colors p-1.5 rounded-lg hover:bg-slate-800"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Zero Data Loss Guarantee Banner */}
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-3">
            <svg className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <div>
              <div className="text-xs font-semibold text-emerald-300">100% Data Preservation Guarantee</div>
              <div className="text-xs text-emerald-400/80 mt-0.5">
                Existing profiles, cookies, proxies, extensions, fingerprints, and local account data will remain completely intact.
              </div>
            </div>
          </div>

          {/* Running Profiles Alert */}
          {runningProfiles.length > 0 && !isUpToDate && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <div className="text-xs font-semibold text-amber-300">Active Browser Profiles Detected</div>
                <div className="text-xs text-amber-400/80 mt-0.5">
                  You have <span className="font-semibold">{runningProfiles.length}</span> active browser window(s) running. Please save your work in open tabs before restarting.
                </div>
              </div>
            </div>
          )}

          {/* Release Notes / Changelog */}
          {updateInfo && !isUpToDate && (
            <div>
              <div className="text-xs font-medium text-slate-400 mb-1.5 flex items-center justify-between">
                <span>Release Notes</span>
                {updateInfo.date && <span className="text-[11px] text-slate-500">{new Date(updateInfo.date).toLocaleDateString()}</span>}
              </div>
              <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-300 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">
                {updateInfo.body || 'No release notes provided.'}
              </div>
            </div>
          )}

          {/* Up to Date Message */}
          {isUpToDate && (
            <div className="py-6 text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 mx-auto flex items-center justify-center text-emerald-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h4 className="text-sm font-semibold text-white">You're using the latest version</h4>
              <p className="text-xs text-slate-400">You're running the newest available release.</p>
            </div>
          )}

          {/* Progress Bar during Download */}
          {isDownloading && (
            <div className="space-y-2 pt-2">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Downloading package...</span>
                <span className="font-mono text-blue-400 font-medium">{progress.percent}%</span>
              </div>
              <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-200"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                <span>{progress.totalBytes > 0 ? `${formatMB(progress.downloadedBytes)} MB / ${formatMB(progress.totalBytes)} MB` : 'Connecting...'}</span>
                <span>Ed25519 Verified</span>
              </div>
            </div>
          )}

          {/* Auto-install countdown */}
          {isReadyToRestart && restartCountdown !== null && (
            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <div>
                <div className="text-xs font-semibold text-blue-300">Auto-restarting in {restartCountdown}s</div>
                <div className="text-xs text-blue-400/80 mt-0.5">
                  App will restart automatically to complete the update. Click "Cancel" to restart manually later.
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {isError && errorMessage && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300 flex items-start gap-2">
              <svg className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="p-5 bg-slate-950/40 border-t border-slate-800 flex items-center justify-end gap-3">
          {isUpToDate ? (
            <button
              onClick={closeModal}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-medium transition-colors"
            >
              Close
            </button>
          ) : isReadyToRestart ? (
            restartCountdown !== null ? (
              <button
                onClick={cancelRestartCountdown}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-medium transition-colors"
              >
                Cancel Auto-Restart
              </button>
            ) : (
              <button
                onClick={relaunchApp}
                className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Restart Now & Apply Update
              </button>
            )
          ) : isDownloading ? (
            <button
              disabled
              className="px-5 py-2.5 bg-blue-600/50 text-blue-200/80 rounded-xl text-xs font-medium flex items-center gap-2 cursor-not-allowed"
            >
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Downloading Update...
            </button>
          ) : isError ? (
            <>
              <button
                onClick={closeModal}
                className="px-4 py-2 text-slate-400 hover:text-white rounded-xl text-xs font-medium transition-colors"
              >
                Dismiss
              </button>
              <button
                onClick={() => checkForUpdates(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium transition-colors"
              >
                Try Again
              </button>
            </>
          ) : (
            <>
              <button
                onClick={closeModal}
                className="px-4 py-2 text-slate-400 hover:text-white rounded-xl text-xs font-medium transition-colors"
              >
                Remind Me Later
              </button>
              <button
                onClick={startDownloadAndInstall}
                disabled={isChecking}
                className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download & Install
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
