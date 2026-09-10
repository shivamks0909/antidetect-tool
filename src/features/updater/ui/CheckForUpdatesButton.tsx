import React from 'react';
import { useUpdaterStore } from '../model/useUpdaterStore';

export const CheckForUpdatesButton: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { status, checkForUpdates, openModal, lastCheckedAt } = useUpdaterStore();
  const isChecking = status === 'checking';

  const handleClick = async () => {
    if (status === 'available' || status === 'ready-to-restart') {
      openModal();
    } else {
      await checkForUpdates(false);
      openModal();
    }
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <button
        onClick={handleClick}
        disabled={isChecking}
        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-800/80 border border-slate-700/80 text-white rounded-xl text-xs font-medium transition-all shadow-sm flex items-center gap-2 disabled:opacity-50"
      >
        {isChecking ? (
          <>
            <svg className="w-3.5 h-3.5 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span>Checking GitHub...</span>
          </>
        ) : status === 'available' ? (
          <>
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
            <span className="text-blue-400 font-semibold">Update Available</span>
          </>
        ) : status === 'ready-to-restart' ? (
          <>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-emerald-400 font-semibold">Restart to Update</span>
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

      {lastCheckedAt && (
        <span className="text-[11px] text-slate-500">
          Last checked: {lastCheckedAt}
        </span>
      )}
    </div>
  );
};
