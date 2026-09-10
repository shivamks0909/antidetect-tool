import React from "react";
import { LayoutDashboard, Users, ShieldAlert, Settings, LogOut, CheckCircle2, ShieldCheck } from "lucide-react";
import { setAuthToken } from "../api/client";

interface SidebarProps {
  activePage: "dashboard" | "users" | "audit" | "security" | "settings";
  setActivePage: (page: "dashboard" | "users" | "audit" | "security" | "settings") => void;
  onLogout: () => void;
  currentUserEmail?: string;
  mongoStatus?: string;
}

export function Sidebar({ activePage, setActivePage, onLogout, currentUserEmail, mongoStatus }: SidebarProps) {
  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col h-screen border-r border-slate-800 select-none">
      {/* Brand Header */}
      <div className="p-6 border-b border-slate-800/80 flex items-center gap-3">
        <img
          src="/opinion_insights_emblem.png?v=3"
          alt="Opinion Insights Logo"
          className="w-9 h-9 object-contain drop-shadow-md shrink-0"
        />
        <div>
          <div className="font-extrabold text-white text-base tracking-tight leading-none flex items-center gap-1">
            Opinion <span className="text-green-400 font-bold">insights</span>
          </div>
          <div className="text-[11px] font-semibold text-slate-400 mt-1 uppercase tracking-wider">
            Admin Console
          </div>
        </div>
      </div>

      {/* Database Connection Status Pill */}
      <div className="px-4 py-3 mx-4 mt-4 bg-slate-800/60 rounded-xl border border-slate-700/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${mongoStatus === "connected" ? "bg-green-500 animate-pulse" : "bg-red-500"}`}></span>
          <span className="text-xs font-semibold text-slate-300">MongoDB Atlas</span>
        </div>
        <span className="text-[11px] font-mono font-bold text-green-400 uppercase">{mongoStatus || "Online"}</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-1.5">
        <button
          onClick={() => setActivePage("dashboard")}
          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
            activePage === "dashboard"
              ? "bg-green-600 text-white shadow-lg shadow-green-600/20"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/50"
          }`}
        >
          <LayoutDashboard className="w-4 h-4" />
          Dashboard
        </button>

        <button
          onClick={() => setActivePage("users")}
          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
            activePage === "users"
              ? "bg-green-600 text-white shadow-lg shadow-green-600/20"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/50"
          }`}
        >
          <Users className="w-4 h-4" />
          User Management
        </button>

        <button
          onClick={() => setActivePage("security")}
          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
            activePage === "security"
              ? "bg-green-600 text-white shadow-lg shadow-green-600/20"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/50"
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          Security & 2FA
        </button>

        <button
          onClick={() => setActivePage("audit")}
          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
            activePage === "audit"
              ? "bg-green-600 text-white shadow-lg shadow-green-600/20"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/50"
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          Audit Logs
        </button>

        <button
          onClick={() => setActivePage("settings")}
          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
            activePage === "settings"
              ? "bg-green-600 text-white shadow-lg shadow-green-600/20"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/50"
          }`}
        >
          <Settings className="w-4 h-4" />
          Settings
        </button>
      </nav>

      {/* User Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/40">
        <div className="flex items-center justify-between">
          <div className="min-w-0 pr-2">
            <div className="text-xs font-bold text-slate-200 truncate">{currentUserEmail || "Admin User"}</div>
            <div className="text-[10px] text-green-400 font-semibold uppercase">Administrator</div>
          </div>
          <button
            onClick={() => {
              setAuthToken(null);
              onLogout();
            }}
            className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
            title="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

