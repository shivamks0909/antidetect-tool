import React, { useEffect, useState } from "react";
import { useAuthStore } from "../../features/auth/model/useAuthStore";
import { API_BASE, apiFetch } from "../../config/api";

interface UserItem {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface AuditLog {
  _id?: string;
  actorEmail: string;
  action: string;
  targetId?: string;
  details?: any;
  timestamp: string;
}

export function AdminPage() {
  const token = useAuthStore((s) => s.token);
  const currentUser = useAuthStore((s) => s.profile);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [healthStatus, setHealthStatus] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"users" | "audit" | "system">("users");

  // Create User Form State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [modalError, setModalError] = useState("");
  const [modalSuccess, setModalSuccess] = useState("");

  const fetchHealth = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/health`);
      const data = await res.json();
      setHealthStatus(data);
    } catch {
      setHealthStatus({ status: "offline", mongodb: "disconnected" });
    }
  };

  const fetchUsers = async () => {
    if (!token) return;
    try {
      const res = await apiFetch(`${API_BASE}/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (e) {
      console.error("Failed to fetch users:", e);
    }
  };

  const fetchAuditLogs = async () => {
    if (!token) return;
    try {
      const res = await apiFetch(`${API_BASE}/admin/audit-logs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
      }
    } catch (e) {
      console.error("Failed to fetch audit logs:", e);
    }
  };

  const refreshAll = async () => {
    await Promise.all([fetchHealth(), fetchUsers(), fetchAuditLogs()]);
  };

  useEffect(() => {
    refreshAll();
  }, [token]);

  const handleToggleUserActive = async (user: UserItem) => {
    if (!token) return;
    try {
      const res = await apiFetch(`${API_BASE}/admin/users/${user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      if (res.ok) {
        fetchUsers();
        fetchAuditLogs();
      }
    } catch (e) {
      console.error("Failed to update user active status:", e);
    }
  };

  const handleChangeUserRole = async (user: UserItem, newRole: string) => {
    if (!token) return;
    try {
      const res = await apiFetch(`${API_BASE}/admin/users/${user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        fetchUsers();
        fetchAuditLogs();
      }
    } catch (e) {
      console.error("Failed to change user role:", e);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!token || !window.confirm("Are you sure you want to delete this user?")) return;
    try {
      const res = await apiFetch(`${API_BASE}/admin/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchUsers();
        fetchAuditLogs();
      }
    } catch (e) {
      console.error("Failed to delete user:", e);
    }
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError("");
    setModalSuccess("");

    if (!newEmail || !newPassword) {
      setModalError("Email and Password are required.");
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/admin/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          fullName: newFullName,
          role: newRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setModalError(data.error || "Failed to create user.");
      } else {
        setModalSuccess("User created successfully!");
        setNewEmail("");
        setNewPassword("");
        setNewFullName("");
        setShowCreateModal(false);
        fetchUsers();
        fetchAuditLogs();
      }
    } catch {
      setModalError("Network error while creating user.");
    }
  };

  if (currentUser?.role !== "admin") {
    return (
      <div className="p-8 text-center bg-red-50 text-red-700 rounded-xl border border-red-200">
        <h2 className="text-xl font-bold mb-2">Access Denied</h2>
        <p>You do not have administrator privileges to view this page.</p>
      </div>
    );
  }

  return (
    <div className="admin-page space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-green-600 animate-pulse"></span>
            Opinion Insights Admin Dashboard
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage users, authorization controls, security audit logs, and database status
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={refreshAll}
            className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Refresh Data
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg shadow-sm transition-all"
          >
            + Create New User
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Users</span>
            <div className="text-2xl font-black text-slate-900 mt-1">{users.length}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-green-50 text-green-600 flex items-center justify-center font-bold">
            👥
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">MongoDB Atlas</span>
            <div className="text-lg font-bold text-green-600 mt-1 capitalize flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>
              {healthStatus?.mongodb || "connected"}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            🍃
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Audit Events</span>
            <div className="text-2xl font-black text-slate-900 mt-1">{auditLogs.length}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            🛡️
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-6">
        <button
          onClick={() => setActiveTab("users")}
          className={`pb-3 text-sm font-bold border-b-2 transition-all ${
            activeTab === "users"
              ? "border-green-600 text-green-600"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          User Management ({users.length})
        </button>
        <button
          onClick={() => setActiveTab("audit")}
          className={`pb-3 text-sm font-bold border-b-2 transition-all ${
            activeTab === "audit"
              ? "border-green-600 text-green-600"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          Audit Logs ({auditLogs.length})
        </button>
        <button
          onClick={() => setActiveTab("system")}
          className={`pb-3 text-sm font-bold border-b-2 transition-all ${
            activeTab === "system"
              ? "border-green-600 text-green-600"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          System Health
        </button>
      </div>

      {/* Tab 1: User Management */}
      {activeTab === "users" && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold text-xs uppercase tracking-wider">
                <th className="py-3.5 px-6">User / Email</th>
                <th className="py-3.5 px-6">Full Name</th>
                <th className="py-3.5 px-6">Role</th>
                <th className="py-3.5 px-6">Status</th>
                <th className="py-3.5 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="py-4 px-6 font-medium text-slate-900">{u.email}</td>
                  <td className="py-4 px-6 text-slate-600">{u.fullName || "-"}</td>
                  <td className="py-4 px-6">
                    <select
                      value={u.role}
                      onChange={(e) => handleChangeUserRole(u, e.target.value)}
                      className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-200 bg-white"
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="py-4 px-6">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        u.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}
                    >
                      {u.isActive ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-right space-x-2">
                    <button
                      onClick={() => handleToggleUserActive(u)}
                      className={`px-3 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                        u.isActive
                          ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                          : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                      }`}
                    >
                      {u.isActive ? "Disable Account" : "Enable Account"}
                    </button>
                    <button
                      onClick={() => handleDeleteUser(u.id)}
                      className="px-3 py-1 text-xs font-semibold rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 2: Audit Logs */}
      {activeTab === "audit" && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold text-xs uppercase tracking-wider">
                <th className="py-3.5 px-6">Timestamp</th>
                <th className="py-3.5 px-6">Actor</th>
                <th className="py-3.5 px-6">Action</th>
                <th className="py-3.5 px-6">Target ID</th>
                <th className="py-3.5 px-6">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-xs">
              {auditLogs.map((log, idx) => (
                <tr key={idx} className="hover:bg-slate-50/50">
                  <td className="py-3 px-6 text-slate-500">{new Date(log.timestamp).toLocaleString()}</td>
                  <td className="py-3 px-6 font-semibold text-slate-800">{log.actorEmail}</td>
                  <td className="py-3 px-6">
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold">
                      {log.action}
                    </span>
                  </td>
                  <td className="py-3 px-6 text-slate-500">{log.targetId || "-"}</td>
                  <td className="py-3 px-6 text-slate-600">{JSON.stringify(log.details || {})}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 3: System Health */}
      {activeTab === "system" && (
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-900">Backend & Database Infrastructure</h2>
          <div className="p-4 bg-slate-50 rounded-xl space-y-2 font-mono text-xs text-slate-700">
            <div>Backend URL: <span className="font-bold text-green-700">{API_BASE}</span></div>
            <div>Database Status: <span className="font-bold text-green-700">{healthStatus?.mongodb || "connected"}</span></div>
            <div>Database Name: <span className="font-bold text-slate-900">opinion_insights</span></div>
            <div>Environment: <span className="font-bold text-blue-700">Production API Mode</span></div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-md p-6 space-y-4">
            <h2 className="text-xl font-black text-slate-900">Create New User</h2>
            {modalError && <div className="p-3 text-xs bg-red-50 text-red-600 rounded-lg">{modalError}</div>}
            {modalSuccess && <div className="p-3 text-xs bg-green-50 text-green-600 rounded-lg">{modalSuccess}</div>}
            <form onSubmit={handleCreateUserSubmit} className="space-y-3 text-sm">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg"
                >
                  Save User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
