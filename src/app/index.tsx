import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@proxyshard/shardx-ui-kit";
import "./styles/index.css";
import "./styles/app.css";
import "flag-icons/css/flag-icons.min.css";
import { App } from "./App";
import { SyncPanel } from "../widgets/SyncPanel";
import { HelperPanel } from "../widgets/HelperPanel";
import { AuthGate } from "../widgets/AuthGate/AuthGate";
import { TitleBar } from "../widgets/TitleBar/TitleBar";

// The always-on-top panels are second Tauri windows on this same bundle,
// addressed by hash — a 60px strip needs no vite entry of its own.
const panelParams = new URLSearchParams(
  window.location.hash.replace(/^#\/?/, ""),
);
const panelGroup = panelParams.get("syncPanel");
const helperProfile = panelParams.get("helperPanel");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      {panelGroup ? (
        <SyncPanel group={panelGroup} />
      ) : helperProfile ? (
        <HelperPanel profile={helperProfile} />
      ) : (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg-weak-50">
          <TitleBar />
          <div
            className="relative flex-1 overflow-hidden"
            style={{ height: "calc(100vh - var(--titlebar-h, 30px))" }}
          >
            <AuthGate>
              <App />
            </AuthGate>
          </div>
        </div>
      )}
    </ThemeProvider>
  </React.StrictMode>,
);
