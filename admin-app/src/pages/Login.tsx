import React, { useState } from "react";
import { Mail, Lock, Eye, EyeOff, MessageSquare, TrendingUp, Users, Target, ShieldCheck, Key } from "lucide-react";
import { api } from "../api/client";

interface LoginProps {
  onLoginSuccess: () => void;
  onForgotPasswordClick?: () => void;
}

export function Login({ onLoginSuccess, onForgotPasswordClick }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // 2FA state
  const [require2FA, setRequire2FA] = useState(false);
  const [tempToken, setTempToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpMessage, setTotpMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (require2FA) {
        // 2FA verification step
        const res = await api.login2FA(tempToken, totpCode);
        if (res.user.role !== "admin") {
          setError("Access Denied. Admin role required.");
          setLoading(false);
          return;
        }
        onLoginSuccess();
        return;
      }

      // Initial login step
      const res = await api.login(email, password);
      if (res.require2FA && res.tempToken) {
        setRequire2FA(true);
        setTempToken(res.tempToken);
        setTotpMessage(res.message || "Enter 6-digit code or recovery code");
        setLoading(false);
        return;
      }

      if (res.user && res.user.role !== "admin") {
        setError("Access Denied. Admin role required to access this portal.");
        setLoading(false);
        return;
      }
      onLoginSuccess();
    } catch (err: any) {
      setError(err.message || "Invalid credentials or 2FA code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 grid grid-cols-1 lg:grid-cols-2 font-sans selection:bg-emerald-500 selection:text-white">
      {/* ─── Left Side: White Brand Presentation ─── */}
      <div className="bg-[#f8fafc] p-8 lg:p-16 flex flex-col justify-center items-center text-center relative overflow-hidden">
        <div className="max-w-md w-full space-y-8 my-auto">
          {/* Top Logo Badge Card */}
          <div className="w-36 h-36 bg-white rounded-3xl p-4 shadow-sm border border-slate-100 mx-auto flex items-center justify-center">
            <img
              src="/opinion_insights_badge_logo.png"
              alt="Opinion Insights"
              className="w-full h-full object-contain"
            />
          </div>

          {/* Title & Subtitle */}
          <div className="space-y-2">
            <h1 className="text-4xl font-normal text-slate-600 tracking-tight">
              Opinion <span className="font-extrabold text-[#00bfa5]">insights</span>
            </h1>
            <p className="text-sm font-semibold text-slate-400">
              Voice Today. Impact Tomorrow.
            </p>
            <div className="w-2 h-2 rounded-full bg-[#00bfa5] mx-auto mt-4"></div>
          </div>

          {/* 2x2 Feature Grid */}
          <div className="grid grid-cols-2 gap-4 text-left pt-2">
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-2xs flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-teal-50 text-[#00bfa5] flex items-center justify-center shrink-0">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-800 leading-tight">Share your</div>
                <div className="text-xs font-bold text-slate-800 leading-tight">opinion</div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-2xs flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-teal-50 text-[#00bfa5] flex items-center justify-center shrink-0">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-800 leading-tight">Drive</div>
                <div className="text-xs font-bold text-slate-800 leading-tight">meaningful change</div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-2xs flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-teal-50 text-[#00bfa5] flex items-center justify-center shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-800 leading-tight">Empower</div>
                <div className="text-xs font-bold text-slate-800 leading-tight">communities</div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-2xs flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-teal-50 text-[#00bfa5] flex items-center justify-center shrink-0">
                <Target className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-800 leading-tight">Create real</div>
                <div className="text-xs font-bold text-slate-800 leading-tight">impact</div>
              </div>
            </div>
          </div>

          {/* Bottom Stats Row */}
          <div className="grid grid-cols-3 gap-2 pt-6 border-t border-slate-200/60">
            <div>
              <div className="text-lg font-extrabold text-[#00bfa5]">40+</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Markets</div>
            </div>
            <div>
              <div className="text-lg font-extrabold text-[#00bfa5]">72h</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Turnaround</div>
            </div>
            <div>
              <div className="text-lg font-extrabold text-[#00bfa5]">99%</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Validation</div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Right Side: Dark Glassmorphic Sign In Card ─── */}
      <div className="bg-[#0b1329] p-8 lg:p-16 flex items-center justify-center">
        <div className="max-w-sm w-full bg-[#131d36]/90 border border-slate-700/60 rounded-3xl p-8 shadow-2xl backdrop-blur-md space-y-6 text-center">
          {/* Centered Logo Badge */}
          <div className="w-24 h-24 bg-white rounded-2xl p-2.5 shadow-lg mx-auto flex items-center justify-center">
            <img
              src="/opinion_insights_badge_logo.png"
              alt="Logo"
              className="w-full h-full object-contain"
            />
          </div>

          {/* Welcome Text */}
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-white tracking-tight">
              {require2FA ? "Two-Factor Verification" : "Welcome back"}
            </h2>
            <p className="text-xs font-medium text-slate-400">
              {require2FA ? totpMessage : "Sign in to your admin account"}
            </p>
          </div>

          {/* Error Box */}
          {error && (
            <div className="p-3 bg-red-950/80 border border-red-800/80 rounded-xl text-red-300 text-xs font-semibold">
              {error}
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4 text-left">
            {!require2FA ? (
              <>
                <div>
                  <div className="relative flex items-center">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                    <input
                      type="email"
                      required
                      placeholder="admin@opinioninsights.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-[#1e293b]/80 border border-slate-700 text-white placeholder-slate-500 font-medium text-xs focus:ring-2 focus:ring-[#10b981] focus:border-[#10b981] outline-none transition-all"
                    />
                  </div>
                </div>

                <div>
                  <div className="relative flex items-center">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 pr-10 py-3 rounded-xl bg-[#1e293b]/80 border border-slate-700 text-white placeholder-slate-500 font-medium text-xs focus:ring-2 focus:ring-[#10b981] focus:border-[#10b981] outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex justify-end mt-1.5">
                    <button
                      type="button"
                      onClick={onForgotPasswordClick}
                      className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                      Forgot Password?
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  6-Digit Authenticator Code or Recovery Code
                </label>
                <div className="relative flex items-center">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 absolute left-3.5 pointer-events-none" />
                  <input
                    type="text"
                    required
                    maxLength={12}
                    placeholder="123456"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-[#1e293b]/80 border border-emerald-500/50 text-white placeholder-slate-500 font-mono text-center tracking-widest text-sm focus:ring-2 focus:ring-[#10b981] outline-none transition-all"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-[#10b981] hover:bg-[#059669] text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/25 transition-all cursor-pointer disabled:opacity-50"
            >
              {loading
                ? require2FA
                  ? "Verifying 2FA..."
                  : "Signing in..."
                : require2FA
                ? "Verify & Continue"
                : "Sign In"}
            </button>
          </form>

          {/* Sub-text / Quick Fill */}
          <div className="pt-2 flex flex-col gap-2 items-center">
            {require2FA ? (
              <button
                onClick={() => {
                  setRequire2FA(false);
                  setTotpCode("");
                  setError("");
                }}
                className="text-[11px] font-medium text-slate-400 hover:text-white transition-colors"
              >
                ← Back to Password Login
              </button>
            ) : (
              <span className="text-[11px] font-medium text-slate-500">
                Authorized Administrator Access Only
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

