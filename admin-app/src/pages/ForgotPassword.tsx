import React, { useState } from "react";
import { Mail, Lock, ArrowLeft, CheckCircle2, ShieldAlert, KeyRound } from "lucide-react";
import { api } from "../api/client";

interface ForgotPasswordProps {
  onBackToLogin: () => void;
}

export function ForgotPassword({ onBackToLogin }: ForgotPasswordProps) {
  const [step, setStep] = useState<"request" | "reset">("request");
  const [email, setEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const res = await fetch("http://localhost:5000/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      setMessage(data.message || "If an account exists for this email, password reset instructions have been sent.");
      setStep("reset");
    } catch {
      setMessage("If an account exists for this email, password reset instructions have been sent.");
      setStep("reset");
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (newPassword !== confirmPassword) {
      setError("New password and confirm password do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("http://localhost:5000/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken.trim(), newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to reset password.");
      } else {
        setMessage(data.message || "Password updated successfully. Please sign in with your new password.");
        setTimeout(() => {
          onBackToLogin();
        }, 2000);
      }
    } catch (err: any) {
      setError(err.message || "Network error during password reset.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b1329] flex items-center justify-center p-4 selection:bg-emerald-500 selection:text-white font-sans">
      <div className="max-w-md w-full bg-[#131d36]/90 border border-slate-700/60 rounded-3xl p-8 shadow-2xl backdrop-blur-md space-y-6 text-center">
        {/* Header Icon */}
        <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 rounded-2xl p-3 shadow-inner mx-auto flex items-center justify-center border border-emerald-500/20">
          <KeyRound className="w-8 h-8" />
        </div>

        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            {step === "request" ? "Forgot Password" : "Reset Your Password"}
          </h2>
          <p className="text-xs font-semibold text-slate-400 mt-1">
            {step === "request"
              ? "Enter your account email to receive a password reset token"
              : "Enter the reset token and choose a strong new password"}
          </p>
        </div>

        {error && (
          <div className="p-3.5 bg-red-950/80 border border-red-800/80 rounded-xl text-red-300 text-xs font-semibold">
            {error}
          </div>
        )}

        {message && (
          <div className="p-3.5 bg-emerald-950/80 border border-emerald-800/80 rounded-xl text-emerald-300 text-xs font-semibold flex items-center gap-2 text-left">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{message}</span>
          </div>
        )}

        {step === "request" ? (
          <form onSubmit={handleRequestSubmit} className="space-y-4 text-left">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                Account Email
              </label>
              <input
                type="email"
                required
                placeholder="admin@opinioninsights.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-[#1e293b]/80 border border-slate-700 text-white placeholder-slate-500 font-medium text-xs focus:ring-2 focus:ring-[#10b981] outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-[#10b981] hover:bg-[#059669] text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/25 transition-all cursor-pointer disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send Reset Instructions"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleResetSubmit} className="space-y-4 text-left">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                Reset Token
              </label>
              <input
                type="text"
                required
                placeholder="Enter 64-character token"
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-[#1e293b]/80 border border-slate-700 text-white placeholder-slate-500 font-mono text-xs focus:ring-2 focus:ring-[#10b981] outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                New Password (Min 12 chars + Special)
              </label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-[#1e293b]/80 border border-slate-700 text-white font-medium text-xs focus:ring-2 focus:ring-[#10b981] outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                Confirm New Password
              </label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-[#1e293b]/80 border border-slate-700 text-white font-medium text-xs focus:ring-2 focus:ring-[#10b981] outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-[#10b981] hover:bg-[#059669] text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/25 transition-all cursor-pointer disabled:opacity-50"
            >
              {loading ? "Updating Password..." : "Update Password"}
            </button>
          </form>
        )}

        <div className="pt-4 border-t border-slate-800">
          <button
            onClick={onBackToLogin}
            className="text-xs font-bold text-slate-400 hover:text-emerald-400 flex items-center justify-center gap-2 mx-auto transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Sign In
          </button>
        </div>
      </div>
    </div>
  );
}
