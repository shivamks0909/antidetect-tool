import React, { useEffect, useState } from "react";
import { X, User, Shield, Calendar, Activity, CheckCircle2, XCircle } from "lucide-react";
import { api, UserItem, AuditLogItem } from "../api/client";

interface UserDetailsModalProps {
  user: UserItem;
  onClose: () => void;
}

export function UserDetailsModal({ user, onClose }: UserDetailsModalProps) {
  const [userLogs, setUserLogs] = useState<AuditLogItem[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  useEffect(() => {
    async function loadLogs() {
      try {
        const res = await api.getAuditLogs();
        const filtered = (res.logs || []).filter(
          (l) => l.actorEmail === user.email || l.targetId === user.id
        );
        setUserLogs(filtered);
      } catch (err) {
        console.error("Failed to load user logs:", err);
      } finally {
        setLoadingLogs(false);
      }
    }
    loadLogs();
  }, [user]);

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-xl overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-green-600 text-white font-black text-lg flex items-center justify-center shadow-md shadow-green-600/20">
              {user.email.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 leading-tight">
                {user.fullName || user.email.split("@")[0]}
              </h2>
              <p className="text-xs font-semibold text-slate-500">{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
              <span className="text-slate-400 font-semibold uppercase tracking-wider block">User ID</span>
              <span className="font-mono font-bold text-slate-800 text-xs break-all">{user.id}</span>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
              <span className="text-slate-400 font-semibold uppercase tracking-wider block">Authorization Role</span>
              <span className="font-bold text-slate-900 capitalize flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-green-600" />
                {user.role}
              </span>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
              <span className="text-slate-400 font-semibold uppercase tracking-wider block">Account Status</span>
              <span className="font-bold flex items-center gap-1.5">
                {user.isActive ? (
                  <span className="text-green-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> Active
                  </span>
                ) : (
                  <span className="text-red-700 flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5 text-red-600" /> Disabled
                  </span>
                )}
              </span>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
              <span className="text-slate-400 font-semibold uppercase tracking-wider block">Date Joined</span>
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                {new Date(user.createdAt).toLocaleDateString()}
              </span>
            </div>

            <div className="p-3.5 bg-emerald-50/60 rounded-xl border border-emerald-100 space-y-1">
              <span className="text-emerald-600 font-semibold uppercase tracking-wider block">Cloud Profiles</span>
              <span className="font-bold text-emerald-950 text-sm">
                {user.profilesCount ?? 0} saved
              </span>
            </div>

            <div className="p-3.5 bg-blue-50/60 rounded-xl border border-blue-100 space-y-1">
              <span className="text-blue-600 font-semibold uppercase tracking-wider block">Cloud Proxies</span>
              <span className="font-bold text-blue-950 text-sm">
                {user.proxiesCount ?? 0} configured
              </span>
            </div>
          </div>

          {/* Audit Trail for this User */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-3 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-green-600" />
              Activity Audit Trail ({userLogs.length})
            </h3>

            {loadingLogs ? (
              <div className="p-4 text-center text-slate-400 text-xs font-medium">Loading activity audit log...</div>
            ) : userLogs.length === 0 ? (
              <div className="p-4 text-center text-slate-400 text-xs font-medium bg-slate-50 rounded-xl border border-slate-100">
                No recorded audit entries for this user yet.
              </div>
            ) : (
              <div className="bg-slate-50 rounded-xl border border-slate-100 divide-y divide-slate-100 text-xs">
                {userLogs.map((log, idx) => (
                  <div key={idx} className="p-3 flex items-center justify-between font-mono">
                    <div>
                      <span className="font-bold text-slate-800">{log.action}</span>
                      <span className="text-slate-400 ml-2 text-[10px]">
                        {JSON.stringify(log.details || {})}
                      </span>
                    </div>
                    <span className="text-slate-400 text-[10px]">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl shadow-2xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
