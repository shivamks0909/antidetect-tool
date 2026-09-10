import React, { useState } from "react";
import { ShieldAlert, Search, Filter, Clock } from "lucide-react";
import { AuditLogItem } from "../api/client";

interface AuditLogsProps {
  logs: AuditLogItem[];
  onRefresh: () => void;
}

export function AuditLogs({ logs }: AuditLogsProps) {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  const actionsList = Array.from(new Set(logs.map((l) => l.action)));

  const filteredLogs = logs.filter((l) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      l.actorEmail.toLowerCase().includes(q) ||
      l.action.toLowerCase().includes(q) ||
      JSON.stringify(l.details || {}).toLowerCase().includes(q);

    const matchesAction = actionFilter === "all" || l.action === actionFilter;

    return matchesSearch && matchesAction;
  });

  return (
    <div className="space-y-6">
      {/* Search & Action Filter Toolbar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by actor email, action type, or details..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-xs font-semibold transition-all"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase">Action Filter:</span>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white shadow-2xs focus:ring-2 focus:ring-green-500 outline-none"
            >
              <option value="all">All Actions ({logs.length})</option>
              {actionsList.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider">
                <th className="py-4 px-6">Timestamp</th>
                <th className="py-4 px-6">Actor Email</th>
                <th className="py-4 px-6">Event Action</th>
                <th className="py-4 px-6">Target User ID</th>
                <th className="py-4 px-6">Audit Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-xs">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400 font-medium font-sans">
                    No audit records match your query.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((l, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 px-6 text-slate-500 flex items-center gap-1.5 whitespace-nowrap">
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      {new Date(l.timestamp).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-6 font-bold text-slate-800 font-sans">{l.actorEmail}</td>
                    <td className="py-3.5 px-6">
                      <span
                        className={`px-2.5 py-1 rounded-lg font-bold text-[11px] inline-block ${
                          l.action.includes("CREATE")
                            ? "bg-green-100 text-green-700"
                            : l.action.includes("DELETE")
                            ? "bg-red-100 text-red-700"
                            : l.action.includes("BLOCKED")
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {l.action}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 text-slate-500">{l.targetId || "-"}</td>
                    <td className="py-3.5 px-6 text-slate-600 max-w-md truncate">
                      {JSON.stringify(l.details || {})}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
