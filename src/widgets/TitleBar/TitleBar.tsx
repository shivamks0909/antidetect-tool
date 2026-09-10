import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HOST_OS } from "../../shared/lib/utils";

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      try {
        const win = getCurrentWindow();
        win.isMaximized().then(setIsMaximized).catch(() => {});
        const unlistenPromise = win.onResized(() => {
          win.isMaximized().then(setIsMaximized).catch(() => {});
        });
        return () => {
          unlistenPromise.then((fn) => fn()).catch(() => {});
        };
      } catch {
        // Dev / non-tauri environment fallback
      }
    }
  }, []);

  const handleDoubleClick = () => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      getCurrentWindow().toggleMaximize().catch(() => {});
    }
  };

  return (
    <div
      className={`fixed left-0 right-0 top-0 z-[10000] flex select-none items-center justify-between border-b border-[#E8EDF5] bg-white text-[#0F172A] [-webkit-user-select:none]${
        HOST_OS === "macOS" ? " titlebar-mac" : " titlebar-custom"
      }`}
      style={{ height: "var(--titlebar-h, 30px)" }}
      data-tauri-drag-region
      onDoubleClick={handleDoubleClick}
    >
      {/* Left side: Logo + Title (Windows / Linux) or empty space for macOS traffic lights */}
      {HOST_OS === "macOS" ? (
        <>
          <div className="w-20" data-tauri-drag-region />
          <div
            className="flex items-center gap-1.5 pointer-events-none"
            data-tauri-drag-region
          >
            <img src="/logo.png" alt="" className="size-3.5 object-contain" />
            <span className="text-[12px] font-medium tracking-tight text-[#475569]">
              Opinion Insights Browser
            </span>
          </div>
          <div className="w-20" data-tauri-drag-region />
        </>
      ) : (
        <>
          <div
            className="flex h-full items-center gap-2 pl-3 pointer-events-none"
            data-tauri-drag-region
          >
            <img src="/logo.png" alt="" className="size-3.5 object-contain" />
            <span className="text-[12px] font-medium tracking-tight text-[#475569]">
              Opinion Insights Browser
            </span>
          </div>

          {/* Draggable center spacer */}
          <div className="flex-1 h-full" data-tauri-drag-region />

          {/* Standard Windows Controls */}
          <div className="flex h-full items-stretch" data-tauri-drag-region="false">
            {/* Minimize */}
            <button
              type="button"
              className="flex h-full w-[46px] cursor-default items-center justify-center border-none bg-transparent p-0 text-[#64748b] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a] focus:outline-none"
              aria-label="Minimize"
              title="Minimize"
              onClick={() => {
                if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
                  getCurrentWindow().minimize().catch(() => {});
                }
              }}
            >
              <svg width="10" height="1" viewBox="0 0 10 1" fill="none" aria-hidden="true">
                <rect width="10" height="1" fill="currentColor" />
              </svg>
            </button>

            {/* Maximize / Restore */}
            <button
              type="button"
              className="flex h-full w-[46px] cursor-default items-center justify-center border-none bg-transparent p-0 text-[#64748b] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a] focus:outline-none"
              aria-label={isMaximized ? "Restore" : "Maximize"}
              title={isMaximized ? "Restore" : "Maximize"}
              onClick={() => {
                if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
                  getCurrentWindow().toggleMaximize().catch(() => {});
                }
              }}
            >
              {isMaximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path
                    d="M2.5 0.5H9.5V7.5M0.5 2.5H7.5V9.5H0.5V2.5Z"
                    stroke="currentColor"
                    strokeWidth="1"
                  />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <rect
                    x="0.5"
                    y="0.5"
                    width="9"
                    height="9"
                    stroke="currentColor"
                    strokeWidth="1"
                  />
                </svg>
              )}
            </button>

            {/* Close */}
            <button
              type="button"
              className="flex h-full w-[46px] cursor-default items-center justify-center border-none bg-transparent p-0 text-[#64748b] transition-colors hover:bg-[#e81123] hover:text-white focus:outline-none"
              aria-label="Close"
              title="Close"
              onClick={() => {
                if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
                  getCurrentWindow().close().catch(() => {});
                }
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path
                  d="M1 1L9 9M9 1L1 9"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
