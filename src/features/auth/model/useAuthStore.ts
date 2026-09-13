import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { API_BASE, apiFetch, registerAuthBridge } from "../../../config/api";
import { useProfile } from "../../../entities/profile";
import { useProxy } from "../../../entities/proxy";
import { useBookmarks } from "../../../entities/bookmark";
import { useExtensions } from "../../../entities/extension";
import { useTrash } from "../../../entities/trash";
import { useFingerprint } from "../../../entities/fingerprint";

export interface AuthUser {
  id: string;
  email: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name?: string | null;
  is_active: boolean;
  role?: string | null;
}

export type AuthStatus =
  | "restoring"
  | "authenticated"
  | "refreshing"
  | "reauth_required"
  | "signed_out"
  | "deactivated"
  | "loading"
  | "unauthenticated"
  | "unconfigured";

export interface AuthState {
  user: AuthUser | null;
  profile: UserProfile | null;
  token: string | null;
  refreshToken: string | null;
  status: AuthStatus;
  error: string | null;
  isBusy: boolean;
  require2FA: boolean;
  tempToken: string | null;

  init: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
  getValidAccessToken: () => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<boolean>;
  verify2FA: (code: string) => Promise<boolean>;
  cancel2FA: () => void;
  signOut: () => Promise<void>;
  clearError: () => void;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
}

export interface SecureSessionPayload {
  token: string;
  refreshToken: string;
  user: AuthUser;
  profile: UserProfile;
  savedAt: number;
}

async function safeInvoke(cmd: string, args?: Record<string, any>): Promise<any> {
  if (typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) {
    try {
      return await invoke(cmd, args);
    } catch (e) {
      console.warn(`[auth] safeInvoke ${cmd} failed:`, e);
      return null;
    }
  }
  return null;
}

async function persistSecureSession(payload: SecureSessionPayload): Promise<void> {
  const json = JSON.stringify(payload);
  const ok = await safeInvoke("auth_save_secure_session", { sessionJson: json });
  if (!ok) {
    try {
      localStorage.setItem("__oi_secure_sess", json);
      sessionStorage.setItem("__oi_secure_sess", json);
    } catch (_) {}
  }
  try {
    localStorage.setItem("opinion_jwt_token", payload.token);
  } catch (_) {}
}

async function loadSecureSession(): Promise<SecureSessionPayload | null> {
  const json = await safeInvoke("auth_load_secure_session");
  if (json && typeof json === "string") {
    try {
      return JSON.parse(json);
    } catch (e) {
      console.warn("[auth] Failed to parse secure session:", e);
    }
  }

  // Web fallback for development
  try {
    const webFallback = localStorage.getItem("__oi_secure_sess") || sessionStorage.getItem("__oi_secure_sess");
    if (webFallback) return JSON.parse(webFallback);
  } catch (_) {}

  // Fallback to legacy localStorage token if present
  try {
    const legacyToken = localStorage.getItem("opinion_jwt_token");
    if (legacyToken) {
      return {
        token: legacyToken,
        refreshToken: "",
        user: { id: "legacy", email: "" },
        profile: { id: "legacy", email: "", is_active: true },
        savedAt: Date.now(),
      };
    }
  } catch (_) {}

  return null;
}

async function wipeSecureSession(): Promise<void> {
  await safeInvoke("auth_clear_secure_session");
  try {
    sessionStorage.removeItem("__oi_secure_sess");
    localStorage.removeItem("__oi_secure_sess");
  } catch (_) {}
  try {
    localStorage.removeItem("opinion_jwt_token");
    localStorage.removeItem("oi_mock_profiles");
    localStorage.removeItem("oi_mock_proxies");
    localStorage.removeItem("shardx-folders");
  } catch (_) {}
}

export const resetUserSessionState = () => {
  try {
    useProfile.getState().reset?.();
    useProxy.getState().reset?.();
    useBookmarks.getState().reset?.();
    useExtensions.getState().reset?.();
    useTrash.getState().reset?.();
    useFingerprint.getState().reset?.();
  } catch (e) {
    console.warn("[auth] error resetting user stores:", e);
  }
  wipeSecureSession().catch(() => {});
};

let heartbeatTimer: any = null;
let consecutiveNetworkFails = 0;
let activeRefreshPromise: Promise<boolean> | null = null;

export const refreshAuthSession = async (): Promise<boolean> => {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = (async () => {
    const store = useAuthStore.getState();
    let currentRefreshToken = store.refreshToken;

    if (!currentRefreshToken) {
      const diskSession = await loadSecureSession();
      if (diskSession?.refreshToken) {
        currentRefreshToken = diskSession.refreshToken;
      }
    }

    if (!currentRefreshToken) {
      console.warn("[auth] No refresh token available for silent renewal");
      return false;
    }

    try {
      const res = await apiFetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: currentRefreshToken }),
      });

      if (res.status === 401 || res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (data.code === "ACCOUNT_DISABLED") {
          await useAuthStore.getState().signOut();
          useAuthStore.setState({
            status: "deactivated",
            error: "Your account has been deactivated. Please contact your administrator.",
          });
          return false;
        }

        // True revocation or token reuse detected -> explicit sign-out
        if (data.code === "REVOKED" || data.code === "REUSE_DETECTED" || data.code === "INVALID_TOKEN") {
          console.warn("[auth] Refresh token explicitly rejected by server:", data.code || res.status);
          await wipeSecureSession();
          await safeInvoke("auth_logout");
          useAuthStore.setState({
            user: null,
            profile: null,
            token: null,
            refreshToken: null,
            status: "signed_out",
            error: "Session expired. Please sign in again.",
          });
          return false;
        }

        // Temporary server errors or unrecognized codes: do NOT clear session!
        console.warn(`[auth] Refresh endpoint returned ${res.status} (${data.code}); preserving session`);
        return false;
      }

      if (res.ok) {
        const data = await res.json();
        const newToken = data.token;
        const newRefreshToken = data.refreshToken;
        const userObj = data.user;

        await persistSecureSession({
          token: newToken,
          refreshToken: newRefreshToken,
          user: { id: userObj.id, email: userObj.email },
          profile: userObj,
          savedAt: Date.now(),
        });

        await safeInvoke("auth_verify_session", {
          token: newToken,
          userId: userObj.id,
          email: userObj.email,
        });

        useAuthStore.setState({
          token: newToken,
          refreshToken: newRefreshToken,
          user: { id: userObj.id, email: userObj.email },
          profile: userObj,
          status: "authenticated",
          error: null,
        });

        return true;
      }

      // 5xx server cold start or unexpected code -> do NOT log out!
      console.warn(`[auth] Refresh endpoint returned status ${res.status}; retaining session in offline mode`);
      return false;
    } catch (netErr) {
      // Network transport failure (e.g. sleep/wake, WiFi glitch) -> do NOT log out!
      console.warn("[auth] Refresh request network failure; retaining session in offline mode:", netErr);
      return false;
    } finally {
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
};

export const useAuthStore = create<AuthState>((set, get) => {
  const handleDeactivation = async (reason?: string) => {
    get().stopHeartbeat();
    resetUserSessionState();
    await safeInvoke("kill_all_user_browsers");
    await safeInvoke("auth_logout");
    set({
      user: null,
      profile: null,
      token: null,
      refreshToken: null,
      status: "deactivated",
      error: reason || "Your account has been deactivated. Please contact your administrator.",
      isBusy: false,
      require2FA: false,
      tempToken: null,
    });
  };

  return {
    user: null,
    profile: null,
    token: null,
    refreshToken: null,
    status: "restoring",
    error: null,
    isBusy: false,
    require2FA: false,
    tempToken: null,

    clearError: () => set({ error: null }),

    refreshSession: refreshAuthSession,

    getValidAccessToken: async () => {
      const currentToken = get().token;
      if (currentToken) return currentToken;
      const refreshed = await refreshAuthSession();
      if (refreshed) return get().token;
      return null;
    },

    startHeartbeat: () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      consecutiveNetworkFails = 0;

      heartbeatTimer = setInterval(async () => {
        const currentToken = get().token || localStorage.getItem("opinion_jwt_token");
        if (!currentToken) {
          get().stopHeartbeat();
          return;
        }

        try {
          const res = await apiFetch(`${API_BASE}/auth/me`, {
            headers: { Authorization: `Bearer ${currentToken}` },
          });

          consecutiveNetworkFails = 0;

          if (res.status === 401) {
            // Access token expired or invalid -> trigger silent background refresh!
            const refreshed = await refreshAuthSession();
            if (!refreshed) {
              // If refresh explicitly failed and cleared session, heartbeat is done
              if (get().status === "signed_out" || get().status === "deactivated") {
                get().stopHeartbeat();
              }
            }
            return;
          }

          if (res.status === 403) {
            const data = await res.json().catch(() => ({}));
            if (data.code === "ACCOUNT_DISABLED") {
              await handleDeactivation("Your account has been deactivated. Please contact your administrator.");
              return;
            }
            const refreshed = await refreshAuthSession();
            if (!refreshed && (get().status === "signed_out" || get().status === "deactivated")) {
              get().stopHeartbeat();
            }
            return;
          }

          if (res.ok) {
            const userData = await res.json();
            if (!userData.is_active) {
              await handleDeactivation("Your account has been deactivated. Please contact your administrator.");
              return;
            }
          }
        } catch (netErr) {
          consecutiveNetworkFails++;
          // Network transport glitch (e.g. computer sleep, WiFi disconnect): NEVER log out!
          console.warn(`[auth] Heartbeat transport notice (#${consecutiveNetworkFails}):`, netErr);
        }
      }, 60000); // 60 seconds interval
    },

    stopHeartbeat: () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    },

    init: async () => {
      set({ status: "restoring" });

      const storedSession = await loadSecureSession();
      if (!storedSession || (!storedSession.token && !storedSession.refreshToken)) {
        await safeInvoke("auth_logout");
        set({
          user: null,
          profile: null,
          token: null,
          refreshToken: null,
          status: "signed_out",
          require2FA: false,
          tempToken: null,
        });
        return;
      }

      // Pre-seed in-memory state from OS secure storage immediately
      set({
        user: storedSession.user || null,
        profile: storedSession.profile || null,
        token: storedSession.token || null,
        refreshToken: storedSession.refreshToken || null,
        status: "authenticated",
        error: null,
      });

      if (storedSession.token && storedSession.user?.id) {
        await safeInvoke("auth_verify_session", {
          token: storedSession.token,
          userId: storedSession.user.id,
          email: storedSession.user.email || "",
        });
      }

      // Verify token with backend or silently refresh
      try {
        const res = await apiFetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${storedSession.token}` },
        });

        if (res.status === 401) {
          // Token expired -> perform silent background refresh
          const refreshed = await refreshAuthSession();
          if (refreshed) {
            get().startHeartbeat();
          }
          return;
        }

        if (res.status === 403) {
          const data = await res.json().catch(() => ({}));
          if (data.code === "ACCOUNT_DISABLED") {
            await handleDeactivation("Your account has been deactivated. Please contact your administrator.");
            return;
          }
          const refreshed = await refreshAuthSession();
          if (refreshed) {
            get().startHeartbeat();
          }
          return;
        }

        if (res.ok) {
          const userData = await res.json();
          if (!userData.is_active) {
            await handleDeactivation("Your account has been deactivated. Please contact your administrator.");
            return;
          }

          set({
            user: { id: userData.id, email: userData.email },
            profile: userData,
            status: "authenticated",
            error: null,
          });

          get().startHeartbeat();
          return;
        }

        // 5xx error on server: retain current session in offline mode!
        console.warn(`[auth] Backend check returned ${res.status}; preserving session`);
        get().startHeartbeat();
      } catch (err) {
        // Network offline / sleep wake: DO NOT LOG OUT!
        console.warn("[auth] Backend check network error during init; preserving session:", err);
        set({ status: "authenticated", error: null });
        get().startHeartbeat();
      }
    },

    signIn: async (identifier: string, password: string) => {
      set({ isBusy: true, error: null });

      const rawInput = identifier.trim();
      const resolvedEmail =
        !rawInput.includes("@") && rawInput.toLowerCase() === "admin"
          ? "admin@opinioninsights.in"
          : rawInput;

      try {
        let res = await apiFetch(`${API_BASE}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: resolvedEmail, password }),
        });

        if (!res.ok && res.status >= 500) {
          try {
            await apiFetch(`${API_BASE}/auth/auto-fix`, { method: "POST" });
            res = await apiFetch(`${API_BASE}/auth/login`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: resolvedEmail, password }),
            });
          } catch (_) {}
        }

        const data = await res.json();

        if (!res.ok || !data.success) {
          set({
            error: data.error || "Invalid email or password.",
            isBusy: false,
          });
          return false;
        }

        if (data.require2FA) {
          set({
            require2FA: true,
            tempToken: data.tempToken,
            isBusy: false,
            error: null,
          });
          return true;
        }

        const token = data.token;
        const refreshToken = data.refreshToken || "";
        const userObj = data.user;

        if (!userObj.is_active) {
          set({
            error: "Your account has been deactivated. Please contact your administrator.",
            isBusy: false,
          });
          return false;
        }

        await persistSecureSession({
          token,
          refreshToken,
          user: { id: userObj.id, email: userObj.email },
          profile: userObj,
          savedAt: Date.now(),
        });

        await safeInvoke("auth_verify_session", {
          token,
          userId: userObj.id,
          email: userObj.email,
        });

        set({
          user: { id: userObj.id, email: userObj.email },
          profile: userObj,
          token,
          refreshToken,
          status: "authenticated",
          error: null,
          isBusy: false,
          require2FA: false,
          tempToken: null,
        });

        get().startHeartbeat();
        return true;
      } catch (err: any) {
        set({
          error: err?.message || "Failed to connect to backend server.",
          isBusy: false,
        });
        return false;
      }
    },

    verify2FA: async (code: string) => {
      const tempToken = get().tempToken;
      if (!tempToken) {
        set({ error: "2FA session expired. Please sign in again.", isBusy: false });
        return false;
      }

      set({ isBusy: true, error: null });

      try {
        const res = await apiFetch(`${API_BASE}/auth/login/2fa`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tempToken, code: code.trim() }),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          set({
            error: data.error || "Invalid 2FA code.",
            isBusy: false,
          });
          return false;
        }

        const token = data.token;
        const refreshToken = data.refreshToken || "";
        const userObj = data.user;

        if (!userObj.is_active) {
          set({
            error: "Your account has been deactivated. Please contact your administrator.",
            isBusy: false,
          });
          return false;
        }

        await persistSecureSession({
          token,
          refreshToken,
          user: { id: userObj.id, email: userObj.email },
          profile: userObj,
          savedAt: Date.now(),
        });

        await safeInvoke("auth_verify_session", {
          token,
          userId: userObj.id,
          email: userObj.email,
        });

        set({
          user: { id: userObj.id, email: userObj.email },
          profile: userObj,
          token,
          refreshToken,
          status: "authenticated",
          require2FA: false,
          tempToken: null,
          error: null,
          isBusy: false,
        });

        get().startHeartbeat();
        return true;
      } catch (err: any) {
        set({
          error: err?.message || "2FA verification failed.",
          isBusy: false,
        });
        return false;
      }
    },

    cancel2FA: () => {
      set({ require2FA: false, tempToken: null, error: null, isBusy: false });
    },

    signOut: async () => {
      set({ isBusy: true });
      get().stopHeartbeat();
      const token = get().token || localStorage.getItem("opinion_jwt_token");
      const refreshToken = get().refreshToken;

      if (token || refreshToken) {
        try {
          await apiFetch(`${API_BASE}/auth/logout`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ refreshToken }),
          });
        } catch (err) {
          console.warn("[auth] backend session revocation notice:", err);
        }
      }

      try {
        await wipeSecureSession();
        resetUserSessionState();
      } finally {
        await safeInvoke("kill_all_user_browsers");
        await safeInvoke("auth_logout");
        set({
          user: null,
          profile: null,
          token: null,
          refreshToken: null,
          status: "signed_out",
          error: null,
          isBusy: false,
          require2FA: false,
          tempToken: null,
        });
      }
    },
  };
});

// Bridge token getter and silent refresh handler to centralized network client
registerAuthBridge(
  () => useAuthStore.getState().token || (typeof localStorage !== "undefined" ? localStorage.getItem("opinion_jwt_token") : null),
  refreshAuthSession
);

