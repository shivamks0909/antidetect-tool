import React from 'react';
import { useUpdaterStore } from '../model/useUpdaterStore';

export const UpdateBanner: React.FC = () => {
  const { status, updateInfo, openModal, relaunchApp } = useUpdaterStore();

  if (status !== 'available' && status !== 'ready-to-restart') {
    return null;
  }

  const isReady = status === 'ready-to-restart';

  return (
    <div className="bg-gradient-to-r from-blue-600/90 via-indigo-600/90 to-purple-600/90 border-b border-indigo-500/30 px-4 py-2 flex items-center justify-between text-xs text-white shadow-lg animate-slide-down">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center">
          {isReady ? (
            <svg className="w-3 h-3 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-3 h-3 text-blue-200 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          )}
        </div>
        <span>
          {isReady ? (
            <>
              Update downloaded! Restart to use version <span className="font-semibold font-mono">v{updateInfo?.version}</span>. (All profile data preserved).
            </>
          ) : (
            <>
              New update <span className="font-semibold font-mono">v{updateInfo?.version}</span> is available for download.
            </>
          )}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {isReady ? (
          <button
            onClick={relaunchApp}
            className="px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-medium shadow-sm transition-colors text-xs"
          >
            Restart Now
          </button>
        ) : (
          <button
            onClick={openModal}
            className="px-3 py-1 bg-white text-slate-900 hover:bg-slate-100 rounded-lg font-medium shadow-sm transition-colors text-xs"
          >
            View & Update
          </button>
        )}
      </div>
    </div>
  );
};
