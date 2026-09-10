import React from "react";
import { Users, UserCheck, UserX, Shield, Activity, Clock } from "lucide-react";
import { UserItem, AuditLogItem, HealthStatus } from "../api/client";

interface DashboardProps {
  users: UserItem[];
  auditLogs: AuditLogItem[];
  health: HealthStatus | null;
  onNavigateToUsers: () => void;
  onNavigateToAudit: () => void;
}

export function Dashboard({ users, auditLogs, health, onNavigateToUsers, onNavigateToAudit }: DashboardProps) {
  const totalUsers = users.length;
  const activeUsers = users.filter((u) => u.isActive).length;
  const disabledUsers = users.filter((u) => !u.isActive).length;
  const adminCount = users.filter((u) => u.role === "admin").length;

  const recentUsers = [...users].reverse().slice(0, 5);
  const recentLogs = auditLogs.slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Top Real Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <div
          onClick={onNavigateToUsers}
          className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Users</span>
            <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-green-100 text-slate-700 group-hover:text-green-700 flex items-center justify-center transition-colors">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-black text-slate-900 mt-2">{totalUsers}</div>
          <div className="text-xs text-slate-500 font-medium mt-1">Real database records</div>
        </div>

        <div
          onClick={onNavigateToUsers}
          className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Active Users</span>
            <div className="w-10 h-10 rounded-xl bg-green-50 text-green-600 flex items-center justify-center">
              <UserCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-black text-green-600 mt-2">{activeUsers}</div>
          <div className="text-xs text-slate-500 font-medium mt-1">Authorized access enabled</div>
        </div>

        <div
          onClick={onNavigateToUsers}
          className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Disabled Users</span>
            <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
              <UserX className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-black text-red-600 mt-2">{disabledUsers}</div>
          <div className="text-xs text-slate-500 font-medium mt-1">Access blocked at login</div>
        </div>

        <div
          onClick={onNavigateToUsers}
          className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Administrators</span>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Shield className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-black text-blue-600 mt-2">{adminCount}</div>
          <div className="text-xs text-slate-500 font-medium mt-1">Full control permissions</div>
        </div>
      </div>

      {/* Main Content Grid: Recent Users & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Users Table */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div>
              <h2 className="font-black text-slate-900 text-base">Recent Users</h2>
              <p className="text-xs font-medium text-slate-500">Latest user accounts added to backend</p>
            </div>
            <button
              onClick={onNavigateToUsers}
              className="text-xs font-bold text-green-600 hover:text-green-700 hover:underline"
            >
              View All Users →
            </button>
          </div>

          <div className="divide-y divide-slate-100 overflow-x-auto">
            {recentUsers.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400 font-medium">No users created yet</div>
            ) : (
              recentUsers.map((u) => (
                <div key={u.id} className="p-4 flex items-center justify-between hover:bg-slate-50/60 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center">
                      {u.email.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">{u.email}</div>
                      <div className="text-xs text-slate-500 font-medium">{u.fullName || "No name set"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md ${
                        u.role === "admin" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {u.role}
                    </span>
                    <span
                      className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md ${
                        u.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}
                    >
                      {u.isActive ? "Active" : "Disabled"}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Activity Audit Stream */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-green-600" />
              <div>
                <h2 className="font-black text-slate-900 text-base">Recent Audit Activity</h2>
                <p className="text-xs font-medium text-slate-500">Live security & user management audit log</p>
              </div>
            </div>
            <button
              onClick={onNavigateToAudit}
              className="text-xs font-bold text-green-600 hover:text-green-700 hover:underline"
            >
              View Full Log →
            </button>
          </div>

          <div className="divide-y divide-slate-100 font-mono text-xs">
            {recentLogs.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400 font-medium font-sans">No audit entries captured yet</div>
            ) : (
              recentLogs.map((log, idx) => (
                <div key={idx} className="p-4 flex items-center justify-between hover:bg-slate-50/60 transition-colors">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 px-2 py-0.5 rounded bg-slate-100 text-[11px]">
                        {log.action}
                      </span>
                      <span className="text-slate-500 text-xs font-sans">{log.actorEmail}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate max-w-md">
                      {JSON.stringify(log.details || {})}
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-400 shrink-0 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
