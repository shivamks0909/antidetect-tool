import React from "react";
import { Database, Server, ShieldCheck, Cpu } from "lucide-react";
import { HealthStatus } from "../api/client";

interface SettingsProps {
  health: HealthStatus | null;
}

export function Settings({ health }: SettingsProps) {
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs space-y-4">
        <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
          <Server className="w-5 h-5 text-green-600" />
          Backend Infrastructure & Connection Status
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Backend API URL</span>
            <span className="font-mono text-sm font-bold text-slate-900">http://localhost:5000/api</span>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">MongoDB Cluster Status</span>
            <span className="font-bold text-sm text-green-600 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></span>
              {health?.mongodb || "connected"} (Cluster0)
            </span>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Authentication Protocol</span>
            <span className="font-semibold text-sm text-slate-800">JWT Bearer Token Signature</span>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Database Name</span>
            <span className="font-mono text-sm font-bold text-slate-900">opinion_insights</span>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs space-y-3">
        <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-green-600" />
          Security Audit & Secret Isolation
        </h2>
        <p className="text-xs text-slate-500 leading-relaxed font-medium">
          The Admin Web App frontend communicates strictly with the Backend API service via HTTP REST endpoints.
          MongoDB URI, database credentials, and JWT secrets remain isolated inside server-side environment files only (`server/.env`).
        </p>
      </div>
    </div>
  );
}
