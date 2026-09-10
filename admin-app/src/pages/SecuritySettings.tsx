import React, { useState, useEffect } from "react";
import { ShieldCheck, Key, Smartphone, Laptop, Trash2, LogOut, CheckCircle2, AlertTriangle, Copy, RefreshCw } from "lucide-react";
import { api } from "../api/client";

export function SecuritySettings() {
  // Password Change State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  // 2FA State
  const [user, setUser] = useState<any>(null);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [disablePassword, setDisablePassword] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [mfaSuccess, setMfaSuccess] = useState("");
  const [settingUpMfa, setSettingUpMfa] = useState(false);

  // Active Sessions State
  const [sessions, setSessions] = useState<Array<any>>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionMsg, setSessionMsg] = useState("");

  const loadData = async () => {
    try {
      const me = await api.getMe();
      setUser(me);
      setTwoFactorEnabled(me.twoFactorEnabled);

      setLoadingSessions(true);
      const s = await api.getActiveSessions();
      setSessions(s.sessions || []);
    } catch (err: any) {
      console.error("Failed to load security data", err);
    } finally {
      setLoadingSessions(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Handle Password Change
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    setChangingPassword(true);
    try {
      const res = await api.changePassword(currentPassword, newPassword);
      setPasswordSuccess(res.message || "Password changed successfully! Other sessions revoked.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      loadData();
    } catch (err: any) {
      setPasswordError(err.message || "Failed to change password.");
    } finally {
      setChangingPassword(false);
    }
  };

  // Setup 2FA
  const handleStart2FASetup = async () => {
    setMfaError("");
    setMfaSuccess("");
    try {
      const res = await api.setup2FA();
      setSecret(res.secret);
      setQrCode(res.qrCode);
      setSettingUpMfa(true);
    } catch (err: any) {
      setMfaError(err.message || "Failed to initiate 2FA setup.");
    }
  };

  // Verify and Enable 2FA
  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setMfaError("");
    setMfaSuccess("");
    try {
      const res = await api.verify2FA(totpCode);
      setRecoveryCodes(res.recoveryCodes || []);
      setTwoFactorEnabled(true);
      setSettingUpMfa(false);
      setMfaSuccess("Two-Factor Authentication enabled successfully! Store your recovery codes safely.");
      loadData();
    } catch (err: any) {
      setMfaError(err.message || "Invalid 2FA code.");
    }
  };

  // Disable 2FA
  const handleDisable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setMfaError("");
    setMfaSuccess("");
    try {
      await api.disable2FA(disablePassword);
      setTwoFactorEnabled(false);
      setDisablePassword("");
      setMfaSuccess("Two-Factor Authentication disabled.");
      loadData();
    } catch (err: any) {
      setMfaError(err.message || "Failed to disable 2FA.");
    }
  };

  // Revoke Single Session
  const handleRevokeSession = async (id: string) => {
    try {
      await api.revokeSessionById(id);
      setSessionMsg("Session revoked successfully.");
      loadData();
    } catch (err: any) {
      setSessionMsg(err.message || "Failed to revoke session.");
    }
  };

  // Revoke All Sessions
  const handleRevokeAllSessions = async () => {
    if (!window.confirm("Are you sure you want to revoke all other active sessions?")) return;
    try {
      await api.revokeAllSessions(true);
      setSessionMsg("All other sessions revoked.");
      loadData();
    } catch (err: any) {
      setSessionMsg(err.message || "Failed to revoke sessions.");
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Top Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <ShieldCheck className="w-7 h-7 text-[#00bfa5]" /> Security & Authentication
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage password policy, multi-factor authentication (2FA), and active admin sessions.
        </p>
      </div>

      {/* ─── SECTION 1: CHANGE PASSWORD ─── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl bg-teal-50 text-[#00bfa5] flex items-center justify-center font-bold">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800">Change Password</h2>
            <p className="text-xs text-slate-500">Requires 12+ chars, uppercase, lowercase, number & special character.</p>
          </div>
        </div>

        {passwordError && (
          <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            {passwordError}
          </div>
        )}

        {passwordSuccess && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            {passwordSuccess}
          </div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4 max-w-xl">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Current Password</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-800 text-xs focus:ring-2 focus:ring-[#00bfa5] outline-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">New Password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-800 text-xs focus:ring-2 focus:ring-[#00bfa5] outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Confirm New Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-800 text-xs focus:ring-2 focus:ring-[#00bfa5] outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={changingPassword}
            className="px-5 py-2.5 bg-[#00bfa5] hover:bg-[#00a892] text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50"
          >
            {changingPassword ? "Updating Password..." : "Update Password"}
          </button>
        </form>
      </div>

      {/* ─── SECTION 2: TWO-FACTOR AUTHENTICATION (2FA / TOTP) ─── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 text-[#00bfa5] flex items-center justify-center font-bold">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Two-Factor Authentication (TOTP 2FA)</h2>
              <p className="text-xs text-slate-500">Secure admin account using Google Authenticator / Authy / 1Password.</p>
            </div>
          </div>

          <span
            className={`px-3 py-1 text-xs font-bold rounded-full ${
              twoFactorEnabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            {twoFactorEnabled ? "ENABLED" : "DISABLED"}
          </span>
        </div>

        {mfaError && (
          <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            {mfaError}
          </div>
        )}

        {mfaSuccess && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            {mfaSuccess}
          </div>
        )}

        {/* Display Recovery Codes when generated */}
        {recoveryCodes.length > 0 && (
          <div className="p-5 bg-amber-50 border border-amber-200 rounded-2xl space-y-3">
            <div className="flex items-center gap-2 text-amber-800 font-bold text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Store these single-use Recovery Codes in a safe place. They will NOT be shown again!
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-xs text-amber-950 font-bold bg-white p-3.5 rounded-xl border border-amber-200 text-center">
              {recoveryCodes.map((code, idx) => (
                <div key={idx} className="bg-amber-100/60 p-1.5 rounded">
                  {code}
                </div>
              ))}
            </div>
          </div>
        )}

        {!twoFactorEnabled && !settingUpMfa && (
          <div>
            <button
              onClick={handleStart2FASetup}
              className="px-5 py-2.5 bg-[#00bfa5] hover:bg-[#00a892] text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
            >
              Enable 2FA Authenticator
            </button>
          </div>
        )}

        {/* 2FA Setup Flow */}
        {settingUpMfa && !twoFactorEnabled && (
          <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl space-y-6 max-w-xl">
            <h3 className="text-sm font-bold text-slate-800">Scan QR Code with Authenticator App</h3>

            <div className="flex flex-col sm:flex-row items-center gap-6">
              {qrCode && <img src={qrCode} alt="2FA QR Code" className="w-40 h-40 bg-white p-2 rounded-xl border border-slate-300" />}
              <div className="space-y-2 text-xs text-slate-600">
                <p>Or manually enter secret code:</p>
                <code className="block p-2 bg-white rounded border border-slate-300 font-mono font-bold text-slate-800 select-all">
                  {secret}
                </code>
              </div>
            </div>

            <form onSubmit={handleVerify2FA} className="space-y-3 pt-2">
              <label className="block text-xs font-semibold text-slate-700">Enter 6-digit Code from Authenticator App</label>
              <div className="flex gap-3">
                <input
                  type="text"
                  required
                  maxLength={6}
                  placeholder="123456"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  className="px-4 py-2 rounded-xl border border-slate-300 font-mono text-center text-sm font-bold w-40 outline-none focus:ring-2 focus:ring-[#00bfa5]"
                />
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#00bfa5] text-white text-xs font-bold rounded-xl hover:bg-[#00a892] cursor-pointer"
                >
                  Verify & Enable
                </button>
                <button
                  type="button"
                  onClick={() => setSettingUpMfa(false)}
                  className="px-4 py-2 bg-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Disable 2FA */}
        {twoFactorEnabled && (
          <form onSubmit={handleDisable2FA} className="space-y-3 max-w-md pt-2">
            <label className="block text-xs font-semibold text-slate-700">Enter Current Password to Disable 2FA</label>
            <div className="flex gap-3">
              <input
                type="password"
                required
                placeholder="Current Password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-slate-800 text-xs outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shrink-0 cursor-pointer"
              >
                Disable 2FA
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ─── SECTION 3: ACTIVE SESSIONS MANAGEMENT ─── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 text-[#00bfa5] flex items-center justify-center font-bold">
              <Laptop className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Active Admin Sessions</h2>
              <p className="text-xs text-slate-500">Inspect and revoke active login sessions across devices.</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              className="p-2 text-slate-500 hover:text-slate-800 bg-slate-100 rounded-xl transition-colors cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={handleRevokeAllSessions}
              className="px-3.5 py-2 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" /> Logout All Other Sessions
            </button>
          </div>
        </div>

        {sessionMsg && (
          <div className="p-3 bg-teal-50 border border-teal-200 text-teal-800 text-xs font-semibold rounded-xl">
            {sessionMsg}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                <th className="py-3 px-4">Device / Browser</th>
                <th className="py-3 px-4">IP Address</th>
                <th className="py-3 px-4">Login Time</th>
                <th className="py-3 px-4">Last Activity</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.map((sess) => (
                <tr key={sess.id} className={sess.isCurrent ? "bg-emerald-50/40" : "hover:bg-slate-50"}>
                  <td className="py-3 px-4 font-medium text-slate-800 flex items-center gap-2">
                    <Laptop className="w-4 h-4 text-slate-400" />
                    <span className="truncate max-w-xs">{sess.userAgent}</span>
                    {sess.isCurrent && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded-md">
                        Current
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600">{sess.ip}</td>
                  <td className="py-3 px-4 text-slate-500">{new Date(sess.createdAt).toLocaleString()}</td>
                  <td className="py-3 px-4 text-slate-500">{new Date(sess.lastActiveAt).toLocaleString()}</td>
                  <td className="py-3 px-4 text-right">
                    {!sess.isCurrent && (
                      <button
                        onClick={() => handleRevokeSession(sess.id)}
                        className="text-red-600 hover:text-red-800 font-bold hover:underline cursor-pointer"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
