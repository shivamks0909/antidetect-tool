import React, { useState } from "react";
import { X, Edit3, Shield, User, KeyRound } from "lucide-react";
import { api, UserItem } from "../api/client";

interface EditUserModalProps {
  user: UserItem;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditUserModal({ user, onClose, onSuccess }: EditUserModalProps) {
  const [fullName, setFullName] = useState(user.fullName || "");
  const [role, setRole] = useState<"admin" | "user">(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const updates: any = { fullName, role, isActive };
      if (password.trim()) {
        updates.password = password.trim();
      }

      await api.updateUser(user.id, updates);
      setMessage("User updated successfully.");
      onSuccess();
      setTimeout(onClose, 800);
    } catch (err: any) {
      setError(err.message || "Failed to update user.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 leading-tight">Edit User Settings</h2>
              <p className="text-xs font-semibold text-slate-500">{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-sm">
          {error && (
            <div className="p-3 text-xs font-semibold bg-red-50 text-red-700 rounded-xl border border-red-200">
              {error}
            </div>
          )}
          {message && (
            <div className="p-3 text-xs font-semibold bg-green-50 text-green-700 rounded-xl border border-green-200">
              {message}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" />
              Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-slate-900 font-medium transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-slate-400" />
              Authorization Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "user" | "admin")}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-slate-900 font-semibold bg-white transition-all"
            >
              <option value="user">Standard User</option>
              <option value="admin">Administrator</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Account Access Status
            </label>
            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                <input
                  type="radio"
                  name="status"
                  checked={isActive}
                  onChange={() => setIsActive(true)}
                  className="text-green-600 focus:ring-green-500"
                />
                <span className="text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-200">Active</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                <input
                  type="radio"
                  name="status"
                  checked={!isActive}
                  onChange={() => setIsActive(false)}
                  className="text-red-600 focus:ring-red-500"
                />
                <span className="text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-200">Disabled</span>
              </label>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-slate-400" />
              Reset Password (Optional)
            </label>
            <input
              type="password"
              placeholder="Leave blank to keep current password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-slate-900 font-medium transition-all"
            />
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 text-xs font-bold text-white bg-green-600 hover:bg-green-700 rounded-xl shadow-md shadow-green-600/20 transition-all disabled:opacity-50"
            >
              {loading ? "Saving Changes..." : "Update User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
