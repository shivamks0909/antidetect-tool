import { useEffect, useRef } from "react";
import { helperProfiles, helperFields, helperShow, helperClose } from "../../entities/profile/model/api";

/**
 * Opens and closes the Shard Helper panel as pages come and go. Renders nothing;
 * lives in the main window because the panel cannot watch for its own reason to
 * exist. Polls — the event is second-scale and the call reads a map in memory.
 */
export function HelperWatcher() {
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const profiles = await helperProfiles();
        if (!alive) return;
        // One panel, so one profile: two would fight for the same corner.
        const next = profiles[0] ?? null;
        if (!next) {
          if (shownFor.current !== null) {
            shownFor.current = null;
            await helperClose();
          }
          return;
        }

        // Only pop up the helper window if there are actual fillable fields detected!
        // Otherwise, HelperPanel immediately calls helperClose, causing a fraction-of-a-second window flash.
        const report = await helperFields(next);
        if (!alive) return;
        const hasFields = Boolean(report?.fields && report.fields.length > 0);

        if (!hasFields) {
          if (shownFor.current !== null) {
            shownFor.current = null;
            await helperClose();
          }
          return;
        }

        if (next === shownFor.current) return;
        shownFor.current = next;
        await helperShow(next);
      } catch { /* the bus may not be up yet */ }
    };
    void tick();
    const id = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return null;
}
