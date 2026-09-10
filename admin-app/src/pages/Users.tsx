import React, { useState } from "react";
import { Search, Filter, UserPlus, Edit3, KeyRound, Trash2, Eye, Shield, CheckCircle2, XCircle } from "lucide-react";
import { api, UserItem } from "../api/client";
import { CreateUserModal } from "../components/CreateUserModal";
import { EditUserModal } from "../components/EditUserModal";
import { UserDetailsModal } from "../components/UserDetailsModal";

interface UsersProps {
  users: UserItem[];
  onRefresh: () => void;
}

export function Users({ users, onRefresh }: UsersProps) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "user">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [detailsUser, setDetailsUser] = useState<UserItem | null>(null);

  // Quick Reset Password Modal state
  const [resetModalUser, setResetModalUser] = useState<UserItem | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetMsg, setResetMsg] = useState("");

  const filteredUsers = users.filter((u) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q || u.email.toLowerCase().includes(q) || (u.fullName && u.fullName.toLowerCase().includes(q));
    const matchesRole = roleFilter === "all" || u.role === roleFilter;
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && u.isActive) ||
      (statusFilter === "disabled" && !u.isActive);

    return matchesSearch && matchesRole && matchesStatus;
  });

  const handleToggleStatus = async (user: UserItem) => {
    try {
      await api.updateUser(user.id, { isActive: !user.isActive });
      onRefresh();
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  const handleChangeRole = async (user: UserItem, newRole: string) => {
    try {
      await api.updateUser(user.id, { role: newRole });
      onRefresh();
    } catch (err: any) {
      alert(`Failed to update role: ${err.message}`);
    }
  };

  const handleDelete = async (user: UserItem) => {
    if (!window.confirm(`Are you sure you want to permanently delete ${user.email}?`)) return;
    try {
      await api.deleteUser(user.id);
      onRefresh();
    } catch (err: any) {
      alert(`Failed to delete user: ${err.message}`);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalUser || !newPassword.trim()) return;
    try {
      await api.updateUser(resetModalUser.id, { password: newPassword.trim() });
      setResetMsg("Password reset successfully!");
      setTimeout(() => {
        setResetModalUser(null);
        setNewPassword("");
        setResetMsg("");
        onRefresh();
      }, 800);
    } catch (err: any) {
      alert(`Failed to reset password: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Search & Filter Toolbar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by user email or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-xs font-semibold transition-all"
            />
          </div>

          {/* Role Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200/80">
            <span className="text-[11px] font-bold text-slate-400 px-2 uppercase">Role:</span>
            {(["all", "admin", "user"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRoleFilter(r)}
                className={`px-3 py-1 text-xs font-bold rounded-lg capitalize transition-all ${
                  roleFilter === r
                    ? "bg-white text-green-700 shadow-2xs border border-slate-200/60"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200/80">
            <span className="text-[11px] font-bold text-slate-400 px-2 uppercase">Status:</span>
            {(["all", "active", "disabled"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 text-xs font-bold rounded-lg capitalize transition-all ${
                  statusFilter === s
                    ? "bg-white text-green-700 shadow-2xs border border-slate-200/60"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Create User Button */}
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold text-xs rounded-xl shadow-md shadow-green-600/20 flex items-center gap-2 transition-all cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          Create New User
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider">
                <th className="py-4 px-6">User / Email</th>
                <th className="py-4 px-6">Full Name</th>
                <th className="py-4 px-6">Role / Level</th>
                <th className="py-4 px-6">Status</th>
                <th className="py-4 px-6">Profiles / Proxies</th>
                <th className="py-4 px-6">Date Joined</th>
                <th className="py-4 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-semibold">
                    No users match your criteria.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                    {/* Email */}
                    <td className="py-4 px-6 font-bold text-slate-900">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 font-black flex items-center justify-center text-xs">
                          {u.email.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div>{u.email}</div>
                          <div className="text-[10px] font-mono text-slate-400 font-normal">ID: {u.id}</div>
                        </div>
                      </div>
                    </td>

                    {/* Name */}
                    <td className="py-4 px-6 text-slate-600">{u.fullName || "-"}</td>

                    {/* Role Dropdown */}
                    <td className="py-4 px-6">
                      <select
                        value={u.role}
                        onChange={(e) => handleChangeRole(u, e.target.value)}
                        className="text-xs font-bold px-2.5 py-1 rounded-lg border border-slate-200 bg-white shadow-2xs focus:ring-2 focus:ring-green-500 outline-none"
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>

                    {/* Status Toggle Badge */}
                    <td className="py-4 px-6">
                      <button
                        onClick={() => handleToggleStatus(u)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                          u.isActive
                            ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                            : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                        }`}
                        title="Click to toggle status"
                      >
                        {u.isActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                        {u.isActive ? "Active" : "Disabled"}
                      </button>
                    </td>

                    {/* Profiles & Proxies Count Badges */}
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70" title="Active Profiles in Cloud">
                          {u.profilesCount ?? 0} Profiles
                        </span>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/70" title="Active Proxies in Cloud">
                          {u.proxiesCount ?? 0} Proxies
                        </span>
                      </div>
                    </td>

                    {/* Created At */}
                    <td className="py-4 px-6 text-slate-500 font-mono">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>

                    {/* Actions */}
                    <td className="py-4 px-6 text-right space-x-1.5">
                      <button
                        onClick={() => setDetailsUser(u)}
                        className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors inline-flex items-center"
                        title="View Details"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => setEditingUser(u)}
                        className="p-1.5 text-slate-600 hover:text-blue-600 bg-slate-100 hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center"
                        title="Edit User"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => setResetModalUser(u)}
                        className="p-1.5 text-slate-600 hover:text-amber-600 bg-slate-100 hover:bg-amber-50 rounded-lg transition-colors inline-flex items-center"
                        title="Reset Password"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => handleDelete(u)}
                        className="p-1.5 text-slate-600 hover:text-red-600 bg-slate-100 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center"
                        title="Delete User"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            onRefresh();
          }}
        />
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSuccess={() => {
            onRefresh();
          }}
        />
      )}

      {/* User Details Modal */}
      {detailsUser && (
        <UserDetailsModal user={detailsUser} onClose={() => setDetailsUser(null)} />
      )}

      {/* Reset Password Modal */}
      {resetModalUser && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-black text-slate-900">Reset Password</h2>
            <p className="text-xs text-slate-500 font-semibold">User: {resetModalUser.email}</p>

            {resetMsg && <div className="p-3 text-xs bg-green-50 text-green-700 font-bold rounded-xl">{resetMsg}</div>}

            <form onSubmit={handleResetPasswordSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetModalUser(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-green-600 hover:bg-green-700 rounded-xl shadow-xs"
                >
                  Confirm Password Reset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
