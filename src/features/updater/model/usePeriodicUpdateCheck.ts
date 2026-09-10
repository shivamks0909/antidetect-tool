import { useEffect, useRef } from 'react';
import { useUpdaterStore } from './useUpdaterStore';

function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

/**
 * Runs periodic update checks based on user preferences.
 * Mount once in App.tsx — handles its own cleanup.
 */
export function usePeriodicUpdateCheck() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isTauriEnvironment()) return;

    const scheduleCheck = () => {
      const { preferences } = useUpdaterStore.getState();
      if (!preferences.autoCheck) return;

      const ms = preferences.checkIntervalHours * 60 * 60 * 1000;

      intervalRef.current = setInterval(() => {
        const { preferences: p } = useUpdaterStore.getState();
        if (!p.autoCheck) return;
        useUpdaterStore.getState().checkForUpdates(true);
      }, ms);
    };

    // Initial startup check at 3s (preserves existing behavior)
    const startupTimer = setTimeout(() => {
      useUpdaterStore.getState().checkForUpdates(true);
      scheduleCheck();
    }, 3000);

    return () => {
      clearTimeout(startupTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
