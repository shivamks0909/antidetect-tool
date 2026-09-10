import React, { useState, useRef, useEffect } from "react";
import { useAuthStore } from "../model/useAuthStore";
import "./login-glass.css";

/* ─── SVG Icons Matching Reference ─── */
function IconMail(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function IconLock(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function IconEye(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

function IconKey(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  );
}

export function LoginForm() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState("");

  const identifierInputRef = useRef<HTMLInputElement>(null);
  const totpInputRef = useRef<HTMLInputElement>(null);

  const signIn = useAuthStore((s) => s.signIn);
  const verify2FA = useAuthStore((s) => s.verify2FA);
  const cancel2FA = useAuthStore((s) => s.cancel2FA);
  const isBusy = useAuthStore((s) => s.isBusy);
  const storeError = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);
  const require2FA = useAuthStore((s) => s.require2FA);

  const displayError = localError || storeError;

  useEffect(() => {
    if (require2FA) {
      totpInputRef.current?.focus();
    } else {
      identifierInputRef.current?.focus();
    }
  }, [require2FA]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    clearError();

    const trimmed = identifier.trim();
    if (!trimmed) {
      setLocalError("Email address or username is required.");
      return;
    }
    if (!password) {
      setLocalError("Password is required.");
      return;
    }

    await signIn(trimmed, password);
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    clearError();

    const trimmedCode = totpCode.trim();
    if (!trimmedCode || trimmedCode.length < 6) {
      setLocalError("Please enter your 6-digit verification code.");
      return;
    }

    await verify2FA(trimmedCode);
  };

  return (
    <div id="login-screen" className="login-screen">
      {/* ─── Left: Brand Hero ─── */}
      <div className="login-hero">
        {/* Decorative background concentric circles */}
        <div className="hero-bg">
          <svg
            className="hero-circle-1"
            viewBox="0 0 600 600"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="300"
              cy="300"
              r="280"
              fill="none"
              stroke="rgba(0,191,165,0.08)"
              strokeWidth="1"
            />
            <circle
              cx="300"
              cy="300"
              r="220"
              fill="none"
              stroke="rgba(0,191,165,0.06)"
              strokeWidth="1"
            />
            <circle
              cx="300"
              cy="300"
              r="160"
              fill="none"
              stroke="rgba(0,191,165,0.04)"
              strokeWidth="1"
            />
          </svg>
          <svg
            className="hero-circle-2"
            viewBox="0 0 400 400"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="200"
              cy="200"
              r="180"
              fill="none"
              stroke="rgba(139,195,74,0.06)"
              strokeWidth="1"
            />
            <circle
              cx="200"
              cy="200"
              r="130"
              fill="none"
              stroke="rgba(139,195,74,0.04)"
              strokeWidth="1"
            />
          </svg>
        </div>

        <div className="hero-content">
          {/* 3D Brand Logo */}
          <div className="hero-logo">
            <img
              src="/brand-logo.png"
              alt="Opinion Insights"
              className="hero-logo-img"
            />
          </div>

          {/* Brand title */}
          <h1 className="hero-title">
            <span className="brand-opinion">Opinion</span>{" "}
            <span className="brand-insights">insights</span>
          </h1>
          <p className="hero-tagline">Voice Today. Impact Tomorrow.</p>

          {/* Divider with glowing teal dot */}
          <div className="hero-divider">
            <span className="divider-dot"></span>
          </div>

          {/* 4 Feature pillars matching reference */}
          <div className="hero-features">
            <div className="hero-feature">
              <div className="feature-icon-circle">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#00BFA5"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
                  <path d="M8 12h.01" />
                  <path d="M12 12h.01" />
                  <path d="M16 12h.01" />
                </svg>
              </div>
              <span className="feature-label">
                Share your
                <br />
                <strong>opinion</strong>
              </span>
            </div>

            <div className="hero-feature">
              <div className="feature-icon-circle">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#8BC34A"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 3v18h18" />
                  <path d="m19 9-5 5-4-4-3 3" />
                </svg>
              </div>
              <span className="feature-label">
                Drive
                <br />
                <strong>meaningful change</strong>
              </span>
            </div>

            <div className="hero-feature">
              <div className="feature-icon-circle">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#00BFA5"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <span className="feature-label">
                Empower
                <br />
                <strong>communities</strong>
              </span>
            </div>

            <div className="hero-feature">
              <div className="feature-icon-circle">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#00BFA5"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
              </div>
              <span className="feature-label">
                Create real
                <br />
                <strong>impact</strong>
              </span>
            </div>
          </div>

          {/* Trust statistics matching reference */}
          <div className="hero-stats">
            <div className="stat">
              <span className="stat-number">40+</span>
              <span className="stat-label">Markets</span>
            </div>
            <div className="stat">
              <span className="stat-number">72h</span>
              <span className="stat-label">Turnaround</span>
            </div>
            <div className="stat">
              <span className="stat-number">99%</span>
              <span className="stat-label">Validation</span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Right: Dark Luxury Glass Form Side ─── */}
      <div className="login-form-side">
        {/* Decorative dot matrix */}
        <svg className="login-dots" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern
              patternUnits="userSpaceOnUse"
              height="24"
              width="24"
              id="loginDots"
            >
              <circle
                fill="rgba(0,191,165,0.08)"
                r="0.8"
                cy="2"
                cx="2"
              ></circle>
            </pattern>
          </defs>
          <rect fill="url(#loginDots)" height="100%" width="100%"></rect>
        </svg>

        {/* Glassmorphic Login Card */}
        <div className="login-card-glass">
          {/* Animated Beams */}
          <div className="beam-container">
            <div className="beam"></div>
            <div className="beam beam-2"></div>
          </div>

          <div className="login-form-inner">
            {/* Center Logo */}
            <div className="login-logo-wrap">
              <img
                src="/brand-logo.png"
                alt="Opinion Insights"
                className="login-logo-img"
              />
            </div>

            <h2 className="login-title">
              {require2FA ? "Two-Factor Verification" : "Welcome back"}
            </h2>
            <p className="login-subtitle">
              {require2FA
                ? "Enter your 6-digit authenticator code"
                : "Sign in to your account"}
            </p>

            {!require2FA ? (
              /* Standard Credentials Form */
              <form
                id="login-form"
                className="login-form-glass"
                onSubmit={handleLoginSubmit}
                autoComplete="off"
                noValidate
              >
                {/* Email / Username */}
                <div className="input-glass-wrap">
                  <IconMail className="input-icon" />
                  <input
                    ref={identifierInputRef}
                    type="text"
                    id="login-email"
                    className="input-glass"
                    placeholder="Email or Username"
                    autoComplete="username"
                    spellCheck="false"
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value);
                      if (localError) setLocalError("");
                    }}
                    disabled={isBusy}
                    required
                  />
                </div>

                {/* Password */}
                <div className="input-glass-wrap">
                  <IconLock className="input-icon" />
                  <input
                    type={showPassword ? "text" : "password"}
                    id="login-password"
                    className="input-glass"
                    placeholder="Password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (localError) setLocalError("");
                    }}
                    disabled={isBusy}
                    required
                  />
                  <button
                    type="button"
                    id="toggle-password"
                    className="toggle-pw-btn"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>

                {/* Error Banner */}
                {displayError && (
                  <div id="login-error" className="login-error-glass">
                    {displayError}
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  className="login-submit-glass"
                  id="login-btn"
                  disabled={isBusy}
                >
                  {isBusy ? (
                    <div className="spinner"></div>
                  ) : (
                    <span className="login-btn-text">Sign In</span>
                  )}
                </button>
              </form>
            ) : (
              /* Two-Factor Authentication TOTP Form */
              <form
                id="totp-form"
                className="login-form-glass"
                onSubmit={handle2FASubmit}
                autoComplete="off"
                noValidate
              >
                <div className="input-glass-wrap">
                  <IconKey className="input-icon" />
                  <input
                    ref={totpInputRef}
                    type="text"
                    id="login-2fa"
                    maxLength={6}
                    className="input-glass totp-glass-input"
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => {
                      setTotpCode(e.target.value.replace(/\D/g, ""));
                      if (localError) setLocalError("");
                    }}
                    disabled={isBusy}
                    required
                  />
                </div>

                {/* Error Banner */}
                {displayError && (
                  <div id="login-error" className="login-error-glass">
                    {displayError}
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  className="login-submit-glass"
                  disabled={isBusy || totpCode.trim().length < 6}
                >
                  {isBusy ? (
                    <div className="spinner"></div>
                  ) : (
                    <span className="login-btn-text">Verify Code</span>
                  )}
                </button>

                {/* Cancel / Return Button */}
                <button
                  type="button"
                  className="cancel-2fa-btn"
                  onClick={() => {
                    cancel2FA();
                    setTotpCode("");
                    setLocalError("");
                  }}
                >
                  Cancel and return to sign in
                </button>
              </form>
            )}

            <p className="login-vendor-hint">
              Enterprise Antidetect Browser Edition &bull; Verified Telemetry
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
